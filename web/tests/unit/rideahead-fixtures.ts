import type { Schemas } from '@/lib/api/client';
import canonical from '@/lib/rideahead/canonical-snapshots.json';

/**
 * Generated frames (`make gen-api`), deep-cloned and sorted by replay time. Tests derive
 * expectations from this structure instead of hard-coding frame keys or IDs.
 */
export function canonicalFrames(): Schemas['SessionSnapshot'][] {
  return Object.entries(canonical)
    .filter(([key]) => key.startsWith('t'))
    .map(([, value]) => structuredClone(value) as unknown as Schemas['SessionSnapshot'])
    .sort((a, b) => a.replay_time_s - b.replay_time_s);
}

export function frameWhere(
  predicate: (frame: Schemas['SessionSnapshot']) => boolean,
): Schemas['SessionSnapshot'] {
  const frame = canonicalFrames().find(predicate);
  if (!frame) throw new Error('No generated frame matches the predicate');
  return frame;
}

/** Latest revealed observation (same rule as the UI). */
export function latestObservation(frame: Schemas['SessionSnapshot']) {
  return frame.observations
    .filter((item) => item.session_time_s <= frame.replay_time_s)
    .reduce<Schemas['Observation'] | null>(
      (latest, item) => (!latest || item.session_time_s >= latest.session_time_s ? item : latest),
      null,
    );
}

/** Inline test data: make the latest observation a cached recorded clip with a Cosmos check. */
export function withRecordedEvidence(
  frame: Schemas['SessionSnapshot'],
  verification: Partial<Schemas['Verification']> = {},
): Schemas['SessionSnapshot'] {
  const snapshot = structuredClone(frame);
  const observation = latestObservation(snapshot);
  if (!observation) throw new Error('Frame has no revealed observation');
  observation.source = 'cached_model';
  observation.support = 'supported';
  const evidence = observation.evidence[0];
  evidence.provenance = 'cached_recorded';
  evidence.media_ref = '/api/archive/media?source=test%2Fclip.mp4';
  evidence.clip_start_s = 2;
  evidence.clip_end_s = 7;
  observation.verification = {
    evidence_id: evidence.evidence_id,
    question: 'Is the bike lane blocked?',
    source: 'cached_model',
    verdict: 'supported',
    rationale: 'Parked car occupies the bike lane.',
    model: 'test-verifier',
    ...verification,
  };
  return snapshot;
}
