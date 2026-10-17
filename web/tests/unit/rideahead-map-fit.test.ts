import { describe, expect, it } from 'vitest';
import { fitMapView, freeRects, intersects } from '@/lib/rideahead/mapFit';
import { toSnapshotView } from '@/lib/rideahead/connection';
import { canonicalFrames } from './rideahead-fixtures';

// Phone-size map (390×844 viewport) with the real overlay layout: decision card, road view
// under it on the right, and bottom-left / bottom-right chrome stacks.
const container = { x: 0, y: 0, width: 366, height: 515 };
const obstacles = [
  { x: 12, y: 12, width: 342, height: 96 },
  { x: 204, y: 116, width: 150, height: 210 },
  { x: 12, y: 420, width: 290, height: 86 },
  { x: 319, y: 432, width: 34, height: 74 },
];
const MARKER = 15;
const box = ([x, y]: [number, number]) => ({
  x: x - MARKER,
  y: y - MARKER,
  width: 2 * MARKER,
  height: 2 * MARKER,
});
const routes = {
  manhattan: [
    { lat: 40.7445, lon: -73.9919 },
    { lat: 40.7537, lon: -73.9846 },
  ],
  london: [
    { lat: 51.5058, lon: -0.105 },
    { lat: 51.505, lon: -0.088 },
  ],
  single: [{ lat: -33.86, lon: 151.21 }],
};

function expectUnobstructed(points: { lat: number; lon: number }[], markerAllowance = 18) {
  const view = fitMapView(container, obstacles, points, { markerAllowance })!;
  expect(view.needsMoreRoom).toBe(false);
  for (const point of points) {
    const marker = box(view.project(point));
    expect(marker.x).toBeGreaterThanOrEqual(container.x);
    expect(marker.y).toBeGreaterThanOrEqual(container.y);
    expect(marker.x + marker.width).toBeLessThanOrEqual(container.width);
    expect(marker.y + marker.height).toBeLessThanOrEqual(container.height);
    for (const obstacle of obstacles) expect(intersects(marker, obstacle)).toBe(false);
  }
  return view;
}

describe('obstruction-aware map fit', () => {
  it('fits a north–south Manhattan route into the tall free column', () => {
    const view = expectUnobstructed(routes.manhattan);
    expect(view.viewport.height).toBeGreaterThan(view.viewport.width);
  });
  it('fits an east–west route unobstructed, preferring the wider area when it is usable', () => {
    expectUnobstructed(routes.london);
    const open = [obstacles[0], obstacles[2], obstacles[3]];
    const view = fitMapView(container, open, routes.london)!;
    expect(view.viewport.width).toBeGreaterThan(view.viewport.height);
  });
  it('keeps a single point unobstructed', () => {
    expectUnobstructed(routes.single);
  });
  it('keeps every generated fixture marker clear of the overlays', () => {
    for (const frame of canonicalFrames()) {
      const snapshot = toSnapshotView(frame);
      const points = [
        ...snapshot.routes.flatMap((route) => route.points),
        ...snapshot.riders.flatMap((rider) => (rider.point ? [rider.point] : [])),
        ...snapshot.hazards.flatMap((hazard) => (hazard.point ? [hazard.point] : [])),
      ];
      expectUnobstructed(points, 36);
    }
  });
  it('asks for more room when overlays cover the map', () => {
    const view = fitMapView(container, [container], routes.manhattan)!;
    expect(view.needsMoreRoom).toBe(true);
  });
  it('returns the whole container when nothing is in the way', () => {
    expect(freeRects(container, [])).toEqual([container]);
  });
  it('returns null when nothing can be mapped', () => {
    expect(fitMapView(container, obstacles, [])).toBeNull();
  });
});
