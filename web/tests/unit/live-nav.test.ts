import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  haversineM,
  nextStepIndex,
  parsePlaces,
  parseRoutes,
  pickDetour,
  pointAhead,
  stepInstruction,
  type NavRoute,
} from '@/lib/liveNav';

const route = (points: [number, number][]): NavRoute => ({
  points,
  distanceM: 0,
  durationS: 0,
  steps: [],
});

describe('live navigation helpers', () => {
  it('measures distance', () => {
    const d = haversineM({ lat: 51.5058, lon: -0.105 }, { lat: 51.5076, lon: -0.099 });
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(500);
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(87)).toBe('90 m');
  });

  it('writes turn instructions', () => {
    expect(
      stepInstruction({ name: 'Blackfriars Rd', maneuver: { type: 'turn', modifier: 'left' } }),
    ).toBe('Turn left onto Blackfriars Rd');
    expect(stepInstruction({ maneuver: { type: 'arrive' } })).toBe('Arrive at your destination');
    expect(stepInstruction({ maneuver: { type: 'roundabout', exit: 2 } })).toBe(
      'At the roundabout, take exit 2',
    );
  });

  it('parses OSRM routes and Nominatim places', () => {
    const routes = parseRoutes({
      code: 'Ok',
      routes: [
        {
          distance: 500,
          duration: 120,
          geometry: {
            coordinates: [
              [-0.105, 51.5058],
              [-0.099, 51.5076],
            ],
          },
          legs: [
            { steps: [{ name: 'A', maneuver: { type: 'depart', location: [-0.105, 51.5058] } }] },
          ],
        },
      ],
    });
    expect(routes[0].points[0]).toEqual([51.5058, -0.105]);
    expect(routes[0].steps[0].instruction).toBe('Head off on A');
    expect(parseRoutes({ code: 'NoRoute' })).toEqual([]);
    expect(
      parsePlaces([{ lat: '51.5', lon: '-0.1', display_name: 'Tate Modern, Bankside, London' }])[0],
    ).toMatchObject({
      name: 'Tate Modern',
      lat: 51.5,
    });
  });

  it('tracks progress through manoeuvres without going backwards', () => {
    const steps = [0, 1, 2].map((i) => ({
      instruction: `s${i}`,
      name: '',
      distanceM: 0,
      location: { lat: 51.5 + i * 0.001, lon: -0.1 },
    }));
    expect(nextStepIndex(steps, { lat: 51.4, lon: -0.1 }, 0)).toBe(1);
    expect(nextStepIndex(steps, { lat: 51.501, lon: -0.1 }, 1)).toBe(2);
    expect(nextStepIndex(steps, { lat: 51.4, lon: -0.1 }, 2)).toBe(2);
  });

  it('detours only around a hazard it actually avoids', () => {
    const straight = route([
      [51.5, -0.1],
      [51.501, -0.1],
      [51.502, -0.1],
    ]);
    const hazard = pointAhead(straight.points, { lat: 51.5, lon: -0.1 }, 40);
    expect(hazard.lat).toBeCloseTo(51.501);
    const around = route([
      [51.5, -0.1],
      [51.5, -0.099],
      [51.502, -0.099],
    ]);
    expect(pickDetour([straight, around], hazard)).toBe(around);
    expect(pickDetour([straight], hazard)).toBeNull();
  });
});
