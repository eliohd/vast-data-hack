import { describe, expect, it } from 'vitest';
import { toSnapshotView } from '@/lib/rideahead/connection';
import {
  geoJsonToLatLng,
  knownMapPoints,
  pointToLatLng,
  routeSegments,
  routeStyle,
  shouldFitSession,
} from '@/lib/rideahead/streetMap';
import { canonicalFrames } from './rideahead-fixtures';

describe('Leaflet coordinates and authoritative route presentation', () => {
  it('converts negative-longitude Manhattan and London GeoJSON in the correct order', () => {
    expect(geoJsonToLatLng([-73.991456, 40.744753])).toEqual([40.744753, -73.991456]);
    expect(geoJsonToLatLng([-0.105, 51.5058, 8])).toEqual([51.5058, -0.105]);
    expect(pointToLatLng({ lat: -33.86, lon: 151.21 })).toEqual([-33.86, 151.21]);
  });
  it('keeps absent and invalid locations unmapped, including zero being a valid coordinate', () => {
    expect(pointToLatLng(null)).toBeNull();
    expect(geoJsonToLatLng([])).toBeNull();
    expect(geoJsonToLatLng([10, 91])).toBeNull();
    expect(geoJsonToLatLng([NaN, 40])).toBeNull();
    expect(geoJsonToLatLng([0, 0])).toEqual([0, 0]);
  });
  it('does not draw through a gap in a backend polyline', () => {
    expect(
      routeSegments([
        { lat: 1, lon: 2 },
        { lat: 2, lon: 3 },
        { lat: NaN, lon: 4 },
        { lat: 5, lon: 6 },
        { lat: 6, lon: 7 },
      ]),
    ).toEqual([
      [
        [1, 2],
        [2, 3],
      ],
      [
        [5, 6],
        [6, 7],
      ],
    ]);
  });
  it('renders actual backend geometry without swapping latitude and longitude or rerouting', () => {
    for (const frame of canonicalFrames()) {
      const view = toSnapshotView(frame);
      for (const [index, route] of view.routes.entries()) {
        expect(routeSegments(route.points)).toEqual([
          frame.routes[index].geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        ]);
      }
      expect(view.decision?.selectedRouteId).toBe(frame.decisions[0].selected_route_id);
      expect(
        knownMapPoints(view).every(([lat, lon]) => lat > 40 && lat < 41 && lon < -73 && lon > -75),
      ).toBe(true);
    }
  });
  it('distinguishes selected and alternative routes without changing the server selection', () => {
    expect(routeStyle(true).dashArray).toBeUndefined();
    expect(routeStyle(false).dashArray).toBeTruthy();
    expect(routeStyle(true).color).not.toBe(routeStyle(false).color);
    const raw = canonicalFrames()[0];
    raw.decisions[0].selected_route_id = raw.routes.at(-1)!.route_id;
    expect(toSnapshotView(raw).decision?.selectedRouteId).toBe(raw.routes.at(-1)!.route_id);
  });
  it('fits a new session once and preserves the viewport during polls and route changes', () => {
    const view = toSnapshotView(canonicalFrames()[0]);
    expect(shouldFitSession(null, view)).toBe(true);
    expect(shouldFitSession(view.id, { ...view, revision: view.revision + 1 })).toBe(false);
    expect(
      shouldFitSession(view.id, {
        ...view,
        decision: { ...view.decision!, selectedRouteId: 'another-route' },
      }),
    ).toBe(false);
    expect(shouldFitSession(view.id, { ...view, id: 'new-session' })).toBe(true);
    expect(shouldFitSession(null, { ...view, routes: [], riders: [], hazards: [] })).toBe(false);
  });
});
