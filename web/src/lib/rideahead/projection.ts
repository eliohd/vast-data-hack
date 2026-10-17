import type { Point } from './view';

/** A rectangle in map-container CSS pixels. */
export type Rect = { x: number; y: number; width: number; height: number };
/** Bounds in normalised Web Mercator units (0–1, y grows southwards). */
export type GeoBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerLat: number;
};
export type MapFit = { project(point: Point): [number, number]; pxPerMetre: number };

const MAX_MERCATOR_LAT = 85.05112878;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

export function isValidPoint(point: Point | null | undefined): point is Point {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

/**
 * Web Mercator in normalised units. Location-agnostic and conformal, so a route keeps its true
 * shape at any latitude, in either hemisphere and for negative longitudes. North is up.
 */
export function mercator(point: Point): { x: number; y: number } {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, point.lat));
  const phi = (lat * Math.PI) / 180;
  return {
    x: (point.lon + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI),
  };
}

function inverseLat(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** Bounds of the valid points, or null when nothing can be placed on the map. */
export function geoBounds(points: (Point | null | undefined)[]): GeoBounds | null {
  const valid = points.filter(isValidPoint).map(mercator);
  if (!valid.length) return null;
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY,
    maxY,
    centerLat: inverseLat((minY + maxY) / 2),
  };
}

/** Ground metres per normalised Mercator unit at the bounds' centre latitude. */
function metresPerUnit(bounds: GeoBounds): number {
  return Math.max(EARTH_CIRCUMFERENCE_M * Math.cos((bounds.centerLat * Math.PI) / 180), 1);
}

/**
 * Fit bounds into a rectangle with one uniform scale, centred, north up and east right.
 * Degenerate bounds (one point, or a perfectly straight north–south / east–west line) are widened
 * to at least `minSpanM` ground metres so the scale stays finite.
 */
export function fitBounds(
  bounds: GeoBounds,
  rect: Rect,
  { minSpanM = 150 }: { minSpanM?: number } = {},
): MapFit {
  const perUnit = metresPerUnit(bounds);
  const minSpan = minSpanM / perUnit;
  const spanX = Math.max(bounds.maxX - bounds.minX, minSpan);
  const spanY = Math.max(bounds.maxY - bounds.minY, minSpan);
  const scale = Math.min(Math.max(rect.width, 0) / spanX, Math.max(rect.height, 0) / spanY);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const originX = rect.x + rect.width / 2;
  const originY = rect.y + rect.height / 2;
  return {
    project(point) {
      const p = mercator(point);
      return [originX + (p.x - centreX) * scale, originY + (p.y - centreY) * scale];
    },
    pxPerMetre: scale / perUnit,
  };
}
