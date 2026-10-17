import { describe, expect, it } from 'vitest';
import { toSnapshotView } from '@/lib/rideahead/connection';
import {
  describeDecisionChange,
  formatArrival,
  formatDelay,
  formatDetour,
  formatDuration,
  initialDecisionTracker,
  trackDecisionChange,
} from '@/lib/rideahead/decisionChange';
import type { SnapshotView } from '@/lib/rideahead/view';
import { canonicalFrames } from './rideahead-fixtures';

const routes: SnapshotView['routes'] = [
  {
    id: 'r1',
    name: 'Original route',
    points: [],
    durationS: 1,
    distanceM: 1,
    provenance: '',
    warnings: [],
  },
  {
    id: 'r2',
    name: 'Detour',
    points: [],
    durationS: 1,
    distanceM: 1,
    provenance: '',
    warnings: [],
  },
];
const decision = (
  overrides: Partial<NonNullable<SnapshotView['decision']>> = {},
): NonNullable<SnapshotView['decision']> => ({
  id: 'dec-1',
  revision: 3,
  timeS: 200,
  riderId: 'bike_b',
  action: 'reroute',
  reason: 'Blocked lane ahead.',
  selectedRouteId: 'r2',
  delayS: null,
  detourS: 39,
  arrivalS: 119,
  changed: true,
  previous: { action: 'heads_up', selectedRouteId: 'r1' },
  evidenceIds: [],
  syntheticBasis: false,
  assumptions: [],
  ...overrides,
});
const snap = (timeS: number, value: NonNullable<SnapshotView['decision']> | null) => ({
  timeS,
  decision: value,
  routes,
});

describe('duration formatting (server values, display only)', () => {
  it('formats whole seconds and minutes', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(7.7)).toBe('8 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(65)).toBe('1 min 5 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(316.29)).toBe('5 min 16 s');
  });
  it('words detour, arrival and delay, hiding absent values', () => {
    expect(formatDetour(7.70426)).toBe('+8 s detour');
    expect(formatDetour(65)).toBe('+1 min 5 s detour');
    expect(formatDetour(-3)).toBe('3 s faster');
    expect(formatDetour(0)).toBe('No extra detour time');
    expect(formatArrival(316.29)).toBe('Report ahead in ~5 min 16 s');
    expect(formatArrival(0)).toBe('Reaching the report now');
    expect(formatDelay(17.99)).toBe('~18 s delay');
    for (const empty of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDetour(empty)).toBeNull();
      expect(formatArrival(empty)).toBeNull();
      expect(formatDelay(empty)).toBeNull();
    }
  });
});

describe('decision change presentation', () => {
  it('words a route change with from → to and the reason', () => {
    const change = describeDecisionChange(decision(), routes)!;
    expect(change.kind).toBe('route');
    expect(change.title).toBe('Route changed');
    expect(change.line).toBe('t=3:20 Route changed: Original route → Detour · Blocked lane ahead.');
  });
  it('words an action change on the same route and flags synthetic evidence', () => {
    const change = describeDecisionChange(
      decision({ action: 'slow', selectedRouteId: 'r1', syntheticBasis: true }),
      routes,
    )!;
    expect(change.kind).toBe('action');
    expect(change.summary).toBe(
      't=3:20 Recommendation changed: Heads up ahead → Slow down · based on a SYNTHETIC event',
    );
  });
  it('announces nothing when the server did not flag a change or there is no previous decision', () => {
    expect(describeDecisionChange(decision({ changed: false }), routes)).toBeNull();
    expect(describeDecisionChange(decision({ previous: null }), routes)).toBeNull();
    expect(describeDecisionChange(null, routes)).toBeNull();
  });
  it('fires once per change across polls, again on a new revision and after a rewind', () => {
    let state = initialDecisionTracker;
    const step = (timeS: number, value: NonNullable<SnapshotView['decision']>) => {
      const result = trackDecisionChange(state, snap(timeS, value));
      state = result.state;
      return result.change;
    };
    expect(step(200, decision())).not.toBeNull();
    expect(step(200, decision())).toBeNull();
    expect(step(205, decision())).toBeNull();
    expect(step(210, decision({ revision: 4 }))).not.toBeNull();
    expect(step(0, decision({ revision: 4 }))).not.toBeNull();
  });
  it('announces exactly the generated frames whose server decision changed after a previous one', () => {
    let state = initialDecisionTracker;
    for (const frame of canonicalFrames()) {
      const view = toSnapshotView(frame);
      const result = trackDecisionChange(state, view);
      state = result.state;
      const expected = Boolean(view.decision?.changed && view.decision.previous);
      expect(result.change !== null).toBe(expected);
    }
  });
});
