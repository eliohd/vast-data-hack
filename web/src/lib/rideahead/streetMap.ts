import type { PathOptions } from 'leaflet';
import { isValidPoint } from './projection';
import type { Point, SnapshotView } from './view';

/** GeoJSON is longitude, latitude; Leaflet's tuple order is latitude, longitude. */
export function geoJsonToLatLng(coordinate: number[]): [number, number] | null {
  if (coordinate.length < 2) return null;
  return pointToLatLng({ lat: coordinate[1], lon: coordinate[0] });
}

export function pointToLatLng(point: Point | null): [number, number] | null {
  return isValidPoint(point) ? [point.lat, point.lon] : null;
}

/** Break a line at missing coordinates: never draw an invented bridge across an unknown section. */
export function routeSegments(points: Point[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const point of points) {
    const location = pointToLatLng(point);
    if (location) current.push(location);
    else {
      if (current.length > 1) segments.push(current);
      current = [];
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Presentation only. Selection comes exclusively from Decision.selected_route_id. */
export function routeStyle(selected: boolean): PathOptions {
  return {
    color: selected ? '#18785e' : '#74618f',
    weight: selected ? 6 : 4,
    opacity: selected ? 1 : 0.8,
    dashArray: selected ? undefined : '9 9',
    lineCap: 'round',
    className: `ra-leaflet-route ${selected ? 'ra-route-selected' : 'ra-route-alternative'}`,
  };
}

export function knownMapPoints(snapshot: SnapshotView): [number, number][] {
  return [
    ...snapshot.routes.flatMap((route) => route.points),
    ...snapshot.riders.map((rider) => rider.point),
    ...snapshot.hazards.map((hazard) => hazard.point),
  ].flatMap((point) => {
    const pair = pointToLatLng(point);
    return pair ? [pair] : [];
  });
}

export function shouldFitSession(fittedSession: string | null, snapshot: SnapshotView): boolean {
  return fittedSession !== snapshot.id && knownMapPoints(snapshot).length > 0;
}
