import { useEffect, useMemo, useRef } from 'react';
import { useMapChrome } from '@/hooks/useMapChrome';
import { lifecycleStyles } from '@/lib/rideahead/lifecycle';
import { fitMapView } from '@/lib/rideahead/mapFit';
import { isValidPoint } from '@/lib/rideahead/projection';
import type { SnapshotView } from '@/lib/rideahead/view';
import { HazardGlyph } from './LifecycleIcon';

const HAZARD_RADIUS = 13;
const RIDER_RADIUS = 10;
const CALLOUT_DROP = 18;

export default function NavigationMap({
  snapshot,
  onSelect,
  onNeedsMoreRoom,
}: {
  snapshot: SnapshotView;
  onSelect: (id: string) => void;
  /** Called when no unobstructed area is large enough; the parent should collapse overlays. */
  onNeedsMoreRoom?: (value: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { size, obstacles } = useMapChrome(ref);
  const points = useMemo(
    () =>
      [
        ...snapshot.routes.flatMap((route) => route.points),
        ...snapshot.riders.map((rider) => rider.point),
        ...snapshot.hazards.map((hazard) => hazard.point),
      ].filter(isValidPoint),
    [snapshot],
  );
  // Room for the marker halo and, below synthetic reports, their SYNTHETIC callout.
  const markerAllowance =
    HAZARD_RADIUS + 5 + (snapshot.hazards.some((hazard) => hazard.synthetic) ? CALLOUT_DROP : 0);
  const view = useMemo(
    () =>
      size && size.width > 0 && size.height > 0
        ? fitMapView({ x: 0, y: 0, ...size }, obstacles, points, { markerAllowance })
        : null,
    [size, obstacles, points, markerAllowance],
  );
  const needsMoreRoom = view?.needsMoreRoom ?? false;
  useEffect(() => {
    onNeedsMoreRoom?.(needsMoreRoom);
  }, [needsMoreRoom, onNeedsMoreRoom]);
  const selectedRoute = snapshot.decision?.selectedRouteId;
  const routes = [...snapshot.routes].sort(
    (a, b) => Number(a.id === selectedRoute) - Number(b.id === selectedRoute),
  );
  const line = (route: SnapshotView['routes'][number]) =>
    view
      ? route.points
          .filter(isValidPoint)
          .map((point) => view.project(point).join(','))
          .join(' ')
      : '';
  return (
    <div ref={ref} className="ra-navigation-map">
      {size && (
        <svg
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
          role="group"
          aria-label="Route overview, north up, with riders and hazard reports"
        >
          <defs>
            <pattern id="nav-grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <rect width="40" height="40" rx="6" fill="#e0e9dc" />
            </pattern>
          </defs>
          <rect width={size.width} height={size.height} fill="#edf1e8" />
          <rect width={size.width} height={size.height} fill="url(#nav-grid)" opacity=".6" />
          {view && (
            <g data-map-viewport={JSON.stringify(view.viewport)}>
              {routes.map((route) => (
                <g key={route.id} data-route-id={route.id}>
                  <polyline
                    points={line(route)}
                    fill="none"
                    stroke="white"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={line(route)}
                    fill="none"
                    stroke={selectedRoute === route.id ? '#16785e' : '#97a593'}
                    strokeWidth="5"
                    strokeDasharray={selectedRoute === route.id ? undefined : '7 6'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ))}
              {snapshot.riders.map((rider) => {
                if (!isValidPoint(rider.point)) return null;
                const [x, y] = view.project(rider.point);
                return (
                  <g key={rider.id} transform={`translate(${x} ${y})`} data-rider-marker={rider.id}>
                    <circle
                      r={RIDER_RADIUS}
                      fill={rider.simulated ? '#197b60' : '#324b43'}
                      stroke="white"
                      strokeWidth="3"
                      strokeDasharray={rider.simulated ? '3 2' : undefined}
                    />
                    <text textAnchor="middle" y="4" fill="white" fontSize="10" fontWeight="700">
                      {rider.id.replace('bike_', '').toUpperCase()}
                    </text>
                    <title>{`${rider.name}${rider.simulated ? ' (simulated)' : ''}`}</title>
                  </g>
                );
              })}
              {snapshot.hazards.map((hazard) => {
                if (!isValidPoint(hazard.point)) return null;
                const [x, y] = view.project(hazard.point);
                const label = `${hazard.title}: ${lifecycleStyles[hazard.state].description}${
                  hazard.synthetic ? ' · synthetic scenario report, not recorded footage' : ''
                }`;
                return (
                  <g
                    key={hazard.id}
                    className="ra-hazard-marker"
                    transform={`translate(${x} ${y})`}
                    data-hazard-marker={hazard.id}
                    data-state={hazard.state}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    onClick={() => onSelect(hazard.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(hazard.id);
                      }
                    }}
                  >
                    <HazardGlyph state={hazard.state} radius={HAZARD_RADIUS} />
                    {hazard.synthetic && (
                      <g transform={`translate(0 ${HAZARD_RADIUS + 11})`} data-synthetic-callout>
                        <rect x="-28" y="-7" width="56" height="14" rx="7" fill="#3b2f0b" />
                        <text
                          textAnchor="middle"
                          y="3"
                          fontSize="8.5"
                          fontWeight="800"
                          letterSpacing=".6"
                          fill="#fff3c4"
                        >
                          SYNTHETIC
                        </text>
                      </g>
                    )}
                    <title>{label}</title>
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      )}
      {size && !view && <p className="ra-no-location">Waiting for route location</p>}
    </div>
  );
}
