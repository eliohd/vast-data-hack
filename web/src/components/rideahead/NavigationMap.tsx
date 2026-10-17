import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { useMapChrome } from '@/hooks/useMapChrome';
import { freeRects } from '@/lib/rideahead/mapFit';
import { lifecycleStyle } from '@/lib/rideahead/lifecycle';
import {
  knownMapPoints,
  pointToLatLng,
  routeSegments,
  routeStyle,
  shouldFitSession,
} from '@/lib/rideahead/streetMap';
import type { SnapshotView } from '@/lib/rideahead/view';
import 'leaflet/dist/leaflet.css';

type MapRuntime = {
  L: typeof Leaflet;
  map: Leaflet.Map;
  routes: Leaflet.LayerGroup;
  riders: Leaflet.LayerGroup;
  hazards: Leaflet.LayerGroup;
};
const glyphs = { observed: '!', confirmed: '!!', stale: '◷', disputed: '?', cleared: '✓' };

/** SafeRoute's layer-group/marker/circle presentation pattern, adapted to backend snapshots.
 * Copyright (c) 2026 SafeRoute contributors, MIT. See /map-notices.txt.
 * No SafeRoute grid, clip-location assignments, simulation or browser routing is used.
 */
export default function NavigationMap({
  snapshot,
  onSelect,
}: {
  snapshot: SnapshotView;
  onSelect: (hazardId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const runtime = useRef<MapRuntime | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [tileState, setTileState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const { size, obstacles } = useMapChrome(ref);
  const fittedSession = useRef<string | null>(null);
  const renderedRevision = useRef<string | null>(null);
  const latest = useRef(snapshot);
  const chrome = useRef({ size, obstacles });
  const select = useRef(onSelect);
  useEffect(() => {
    latest.current = snapshot;
    select.current = onSelect;
  }, [snapshot, onSelect]);
  useEffect(() => {
    chrome.current = { size, obstacles };
  }, [size, obstacles]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    void import('leaflet')
      .then((L) => {
        if (disposed || !ref.current) return;
        const map = L.map(ref.current, { zoomControl: false, attributionControl: true }).setView(
          [0, 0],
          2,
        );
        runtime.current = {
          L,
          map,
          routes: L.layerGroup().addTo(map),
          riders: L.layerGroup().addTo(map),
          hazards: L.layerGroup().addTo(map),
        };
        // Direct browser requests: no upstream credentials, proxy, bulk download or prefetch.
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          keepBuffer: 0,
          updateWhenIdle: true,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Routes &copy; <a href="https://openrouteservice.org/">openrouteservice</a> · <a href="/map-notices.txt">Notices</a>',
        });
        let errors = 0;
        let loaded = 0;
        tiles.on('loading', () => {
          errors = 0;
          loaded = 0;
          setTileState('loading');
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (!disposed) setTileState('unavailable');
          }, 12000);
        });
        tiles.on('tileerror', () => {
          errors += 1;
          setTileState('unavailable');
        });
        tiles.on('tileload', () => {
          loaded += 1;
        });
        tiles.on('load', () => {
          window.clearTimeout(timer);
          setTileState(errors || !loaded ? 'unavailable' : 'available');
        });
        tiles.addTo(map);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setMapError(true);
      });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      runtime.current?.map.remove();
      runtime.current = null;
      fittedSession.current = null;
      renderedRevision.current = null;
    };
  }, []);

  function recenter() {
    const state = runtime.current;
    if (!state) return;
    const points = knownMapPoints(latest.current);
    if (!points.length) return;
    const { size: dimensions, obstacles: overlays } = chrome.current;
    const free = dimensions
      ? freeRects({ x: 0, y: 0, ...dimensions }, overlays).sort(
          (a, b) => b.width * b.height - a.width * a.height,
        )[0]
      : null;
    state.map.invalidateSize({ pan: false });
    state.map.fitBounds(state.L.latLngBounds(points), {
      maxZoom: 17,
      animate: false,
      paddingTopLeft: free ? [free.x + 24, free.y + 24] : [36, 150],
      paddingBottomRight:
        free && dimensions
          ? [
              dimensions.width - free.x - free.width + 24,
              dimensions.height - free.y - free.height + 24,
            ]
          : [36, 220],
    });
  }
  const recenterRef = useRef(recenter);
  useEffect(() => {
    recenterRef.current = recenter;
  });

  useEffect(() => {
    const state = runtime.current;
    if (!ready || !state) return;
    const { L, map, routes, riders, hazards } = state;
    const revisionKey = `${snapshot.id}:${snapshot.revision}`;
    if (renderedRevision.current === revisionKey) {
      if (size && shouldFitSession(fittedSession.current, snapshot)) {
        recenterRef.current();
        fittedSession.current = snapshot.id;
      }
      return;
    }
    renderedRevision.current = revisionKey;
    routes.clearLayers();
    riders.clearLayers();
    hazards.clearLayers();
    // Alternatives first; draw the authoritative selection last so it is visible on overlaps.
    const selectedId = snapshot.decision?.selectedRouteId;
    const sortedRoutes = [...snapshot.routes].sort(
      (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
    );
    for (const route of sortedRoutes)
      for (const points of routeSegments(route.points)) {
        const selected = route.id === selectedId;
        L.polyline(points, {
          color: '#fff',
          weight: selected ? 10 : 7,
          opacity: 0.85,
          interactive: false,
        }).addTo(routes);
        const line = L.polyline(points, { ...routeStyle(selected), interactive: false }).addTo(
          routes,
        );
        const element = line.getElement();
        if (element) {
          element.setAttribute('data-route-id', route.id);
          element.setAttribute('data-selected', String(selected));
        }
      }
    for (const [index, rider] of snapshot.riders.entries()) {
      const point = pointToLatLng(rider.point);
      if (!point) continue;
      const icon = document.createElement('span');
      icon.className = `ra-rider-pin ${rider.simulated ? 'is-simulated' : 'is-recorded'}`;
      icon.textContent = index === 0 ? 'A' : 'B';
      const label = `${rider.name}${rider.simulated ? ' · simulated' : ' · recorded observer'}`;
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: 'ra-leaflet-pin',
          html: icon,
          iconSize: [34, 34],
          // Lift the recorded observer above its coordinate, with a stem to the true anchor.
          // A fixed camera and its report can share that point without hiding each other.
          iconAnchor: rider.simulated ? [17, 17] : [17, 46],
        }),
        title: label,
        alt: label,
        zIndexOffset: 500,
      }).addTo(riders);
      const tooltip = document.createElement('span');
      tooltip.textContent = label;
      marker.bindTooltip(tooltip);
      marker.getElement()?.setAttribute('data-rider-id', rider.id);
    }
    for (const hazard of snapshot.hazards) {
      const point = pointToLatLng(hazard.point);
      if (!point) continue;
      const style = lifecycleStyle(hazard.state);
      if (
        hazard.uncertaintyM != null &&
        Number.isFinite(hazard.uncertaintyM) &&
        hazard.uncertaintyM > 0
      ) {
        L.circle(point, {
          radius: hazard.uncertaintyM,
          color: style.stroke,
          fillColor: style.fill,
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '3 5',
          interactive: false,
          className: 'ra-location-uncertainty',
        }).addTo(hazards);
      }
      const content = document.createElement('span');
      content.className = `ra-hazard-pin is-${hazard.state}`;
      content.style.backgroundColor = style.fill;
      content.style.borderColor = style.stroke;
      content.style.color = style.iconColor;
      content.textContent = glyphs[hazard.state];
      const badge = document.createElement('small');
      badge.textContent = `${style.label}${hazard.synthetic ? ' · SYNTHETIC' : ''}`;
      content.append(badge);
      const label = `${hazard.title} · ${style.description}${hazard.synthetic ? ' · synthetic event' : ''} · ${hazard.uncertaintyM == null ? 'location uncertainty unknown' : `location ±${hazard.uncertaintyM} m`}. Open evidence`;
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: 'ra-leaflet-pin',
          html: content,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        keyboard: true,
        title: label,
        alt: label,
        zIndexOffset: 1000,
      }).addTo(hazards);
      const el = marker.getElement();
      el?.setAttribute('aria-label', label);
      el?.setAttribute('data-hazard-id', hazard.id);
      el?.setAttribute('data-state', hazard.state);
      // Leaflet's generic div markers need explicit keyboard activation without a bound popup.
      el?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          select.current(hazard.id);
        }
      });
      marker.on('click', () => select.current(hazard.id));
    }
    // Polling, decisions and rider movement never change the user's zoom/pan.
    if (size && shouldFitSession(fittedSession.current, snapshot)) {
      recenterRef.current();
      fittedSession.current = snapshot.id;
    }
    map.getContainer().setAttribute('data-session-revision', String(snapshot.revision));
  }, [ready, snapshot, size]);
  useEffect(() => {
    if (ready && size) runtime.current?.map.invalidateSize({ pan: false });
  }, [ready, size]);

  const points = knownMapPoints(snapshot);
  const unmapped = snapshot.hazards.filter((hazard) => !pointToLatLng(hazard.point)).length;
  return (
    <>
      <div
        ref={ref}
        className="ra-navigation-map"
        role="region"
        aria-label="Interactive OpenStreetMap street map with routes, riders and hazards"
      />
      <div className="ra-map-tools" data-map-chrome aria-label="Map controls">
        <button
          aria-label="Zoom in"
          disabled={!ready}
          onClick={() => runtime.current?.map.zoomIn()}
        >
          <Plus size={19} />
        </button>
        <button
          aria-label="Zoom out"
          disabled={!ready}
          onClick={() => runtime.current?.map.zoomOut()}
        >
          <Minus size={19} />
        </button>
        <button aria-label="Recenter route" disabled={!ready || !points.length} onClick={recenter}>
          <Crosshair size={19} />
        </button>
      </div>
      {(mapError || tileState !== 'available' || !points.length || unmapped > 0) && (
        <div className="ra-map-status" role="status" data-map-chrome>
          {mapError
            ? 'Interactive map failed to load. Route details and evidence remain available.'
            : !points.length
              ? 'No known coordinates. Locations have not been placed on the map.'
              : tileState === 'unavailable'
                ? 'Street tiles unavailable or incomplete. Route geometry is still shown.'
                : tileState === 'loading'
                  ? 'Loading street map…'
                  : null}
          {unmapped > 0 && <span>{unmapped} report(s) have no valid location · view Evidence</span>}
        </div>
      )}
    </>
  );
}
