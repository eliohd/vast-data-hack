import type { SnapshotView } from './view';

export function distanceLabel(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return '—';
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/** Format server estimates. Never derive distance, duration or maneuvers from geometry here. */
export function journeyFor(snapshot: SnapshotView | null, now: number) {
  const rider = snapshot?.riders.find((item) => item.id === snapshot.decision?.riderId);
  const route = snapshot?.routes.find((item) => item.id === rider?.activeRouteId);
  const remaining = rider?.remainingDurationS;
  const validDuration = remaining != null && Number.isFinite(remaining) && remaining >= 0;
  const arrived = rider?.status === 'arrived';
  const step = rider?.nextStepIndex != null ? route?.steps?.[rider.nextStepIndex] : undefined;
  return {
    minutes: validDuration ? String(Math.ceil(remaining / 60)) : '—',
    distance: distanceLabel(rider?.remainingDistanceM),
    arrival: validDuration
      ? new Date(now + remaining * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—',
    instruction: arrived ? 'You’ve arrived' : (step?.instruction ?? 'Follow your route'),
    nextDistance: step && !arrived ? distanceLabel(rider?.distanceToNextStepM) : null,
    maneuver: arrived ? 'arrive' : (step?.maneuver_type ?? 'unknown'),
    street: step?.street_name ?? null,
    hasDirections: arrived || !!step,
  };
}
