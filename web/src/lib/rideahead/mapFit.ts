import { fitBounds, geoBounds, type MapFit, type Rect } from './projection';
import type { Point } from './view';

export type MapView = MapFit & {
  /** Unobstructed rectangle the geometry was fitted into. */
  viewport: Rect;
  /** True when no unobstructed rectangle was large enough; the caller should collapse chrome. */
  needsMoreRoom: boolean;
};

/** Positive-area overlap; touching edges do not count. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function inset(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: rect.width - 2 * amount,
    height: rect.height - 2 * amount,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function edges(start: number, end: number, values: number[]): number[] {
  return [...new Set([start, end, ...values.map((v) => Math.min(end, Math.max(start, v)))])].sort(
    (a, b) => a - b,
  );
}

/**
 * Maximal rectangles inside `container` that avoid every obstacle (each grown by `gap`).
 * Brute force over obstacle edges; fine for the handful of overlay elements on the map.
 */
export function freeRects(
  container: Rect,
  obstacles: Rect[],
  { minSize = 96, gap = 6 }: { minSize?: number; gap?: number } = {},
): Rect[] {
  const blocked = obstacles
    .filter((item) => item.width > 0 && item.height > 0)
    .map((item) => inset(item, -gap))
    .filter((item) => intersects(item, container));
  const right = container.x + container.width;
  const bottom = container.y + container.height;
  const xs = edges(
    container.x,
    right,
    blocked.flatMap((item) => [item.x, item.x + item.width]),
  );
  const ys = edges(
    container.y,
    bottom,
    blocked.flatMap((item) => [item.y, item.y + item.height]),
  );
  const candidates: Rect[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] - xs[i] < minSize) continue;
      for (let k = 0; k < ys.length; k++)
        for (let l = k + 1; l < ys.length; l++) {
          const rect = { x: xs[i], y: ys[k], width: xs[j] - xs[i], height: ys[l] - ys[k] };
          // Taller rectangles from the same top edge only add more overlap.
          if (blocked.some((item) => intersects(item, rect))) break;
          if (rect.height >= minSize) candidates.push(rect);
        }
    }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  const maximal: Rect[] = [];
  for (const rect of candidates)
    if (!maximal.some((kept) => contains(kept, rect))) maximal.push(rect);
  return maximal;
}

/**
 * Fit every point into the free rectangle that gives the largest scale, leaving `markerAllowance`
 * pixels so marker symbols (not just their centres) stay clear of overlays.
 */
export function fitMapView(
  container: Rect,
  obstacles: Rect[],
  points: Point[],
  { markerAllowance = 18, minSize = 96 }: { markerAllowance?: number; minSize?: number } = {},
): MapView | null {
  const bounds = geoBounds(points);
  if (!bounds) return null;
  let best: { fit: MapFit; rect: Rect } | null = null;
  for (const rect of freeRects(container, obstacles, { minSize })) {
    const inner = inset(rect, markerAllowance);
    if (inner.width <= 0 || inner.height <= 0) continue;
    const fit = fitBounds(bounds, inner);
    const better =
      !best ||
      fit.pxPerMetre > best.fit.pxPerMetre * (1 + 1e-9) ||
      (fit.pxPerMetre >= best.fit.pxPerMetre * (1 - 1e-9) &&
        rect.width * rect.height > best.rect.width * best.rect.height);
    if (better) best = { fit, rect };
  }
  if (best) return { ...best.fit, viewport: best.rect, needsMoreRoom: false };
  const viewport = inset(container, markerAllowance);
  return { ...fitBounds(bounds, viewport), viewport, needsMoreRoom: true };
}
