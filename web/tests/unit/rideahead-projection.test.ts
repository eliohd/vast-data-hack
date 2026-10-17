import { describe, expect, it } from 'vitest';
import { fitBounds, geoBounds, isValidPoint } from '@/lib/rideahead/projection';

const rect = { x: 20, y: 30, width: 300, height: 400 };
const cases = {
  manhattan: [
    { lat: 40.747, lon: -73.99 },
    { lat: 40.756, lon: -73.985 },
  ],
  london: [
    { lat: 51.505, lon: -0.105 },
    { lat: 51.5058, lon: -0.088 },
  ],
  sydney: [
    { lat: -33.87, lon: 151.2 },
    { lat: -33.86, lon: 151.21 },
  ],
};

describe('location-agnostic Web Mercator fit', () => {
  for (const [name, [southWest, northEast]] of Object.entries(cases))
    it(`keeps north up, east right and true proportions in ${name}`, () => {
      const fit = fitBounds(geoBounds([southWest, northEast])!, rect);
      const a = fit.project(southWest);
      const b = fit.project(northEast);
      expect(b[1]).toBeLessThan(a[1]);
      expect(b[0]).toBeGreaterThan(a[0]);
      const lat = ((southWest.lat + northEast.lat) / 2) * (Math.PI / 180);
      const groundX = (northEast.lon - southWest.lon) * Math.cos(lat) * 111320;
      const groundY = (northEast.lat - southWest.lat) * 110574;
      const ratio = (b[0] - a[0]) / (a[1] - b[1]);
      expect(Math.abs(ratio / (groundX / groundY) - 1)).toBeLessThan(0.02);
      for (const [x, y] of [a, b]) {
        expect(x).toBeGreaterThanOrEqual(rect.x - 1e-6);
        expect(x).toBeLessThanOrEqual(rect.x + rect.width + 1e-6);
        expect(y).toBeGreaterThanOrEqual(rect.y - 1e-6);
        expect(y).toBeLessThanOrEqual(rect.y + rect.height + 1e-6);
      }
      // pxPerMetre agrees with the projected ground distance.
      expect(Math.abs((b[0] - a[0]) / fit.pxPerMetre / groundX - 1)).toBeLessThan(0.02);
    });

  it('maps a single point to the centre and keeps degenerate bounds finite', () => {
    const point = { lat: 40.75, lon: -73.99 };
    expect(fitBounds(geoBounds([point])!, rect).project(point)).toEqual([170, 230]);
    const line = [
      { lat: 40.74, lon: -73.99 },
      { lat: 40.76, lon: -73.99 },
    ];
    const fit = fitBounds(geoBounds(line)!, rect);
    for (const p of line) {
      const [x, y] = fit.project(p);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeCloseTo(170);
      expect(y).toBeGreaterThanOrEqual(rect.y - 1e-6);
      expect(y).toBeLessThanOrEqual(rect.y + rect.height + 1e-6);
    }
  });

  it('leaves unknown geography unmapped', () => {
    expect(geoBounds([])).toBeNull();
    expect(geoBounds([{ lat: 100, lon: 0 }])).toBeNull();
    expect(isValidPoint({ lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
});
