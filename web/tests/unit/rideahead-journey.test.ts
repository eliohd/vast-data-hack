import { describe, expect, it } from 'vitest';
import { toSnapshotView } from '@/lib/rideahead/connection';
import { distanceLabel, journeyFor } from '@/lib/rideahead/journey';
import { canonicalFrames } from './rideahead-fixtures';

describe('backend journey estimates and turn instructions', () => {
  it('uses remaining journey fields and the backend maneuver index, not whole-route totals', () => {
    const raw = canonicalFrames()[0];
    const rider = raw.riders.find((item) => item.rider_id === raw.decisions[0].rider_id)!;
    const route = raw.routes.find((item) => item.route_id === rider.active_route_id)!;
    rider.distance_remaining_m = 425;
    rider.duration_remaining_s = 93;
    rider.next_step_index = 0;
    rider.distance_to_next_step_m = 75;
    const view = toSnapshotView(raw);
    const now = Date.UTC(2026, 9, 17, 12, 0);
    const journey = journeyFor(view, now);
    expect(journey.minutes).toBe('2');
    expect(journey.distance).toBe('425 m');
    expect(journey.arrival).toBe(
      new Date(now + 93000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
    expect(journey.instruction).toBe(route.steps![0].instruction);
    expect(journey.nextDistance).toBe('75 m');
  });
  it('shows unavailable estimates honestly, even if the whole route has duration and distance', () => {
    const view = toSnapshotView(canonicalFrames()[0]);
    const rider = view.riders.find((item) => item.id === view.decision?.riderId)!;
    rider.remainingDistanceM = null;
    rider.remainingDurationS = null;
    rider.nextStepIndex = null;
    expect(journeyFor(view, 0)).toMatchObject({
      minutes: '—',
      distance: '—',
      arrival: '—',
      hasDirections: false,
    });
    expect(journeyFor(null, 0).arrival).toBe('—');
  });
  it('only announces arrival when the backend rider status says arrived', () => {
    const view = toSnapshotView(canonicalFrames()[0]);
    const rider = view.riders.find((item) => item.id === view.decision?.riderId)!;
    rider.status = 'arrived';
    expect(journeyFor(view, 0).instruction).toBe('You’ve arrived');
  });
  it('does not invent distances for null, negative, infinite or NaN values', () => {
    for (const value of [undefined, null, -1, Infinity, NaN])
      expect(distanceLabel(value)).toBe('—');
    expect(distanceLabel(0)).toBe('0 m');
    expect(distanceLabel(1200)).toBe('1.2 km');
  });
});
