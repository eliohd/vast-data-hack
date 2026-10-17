import { describe, expect, it } from 'vitest';
import { toSnapshotView } from '@/lib/rideahead/connection';
import { clipWindow, recordedLabel, roadViewFor, verdictLabel } from '@/lib/rideahead/roadView';
import { claimTrust } from '@/lib/rideahead/trust';
import { safeMediaPath } from '@/lib/rideahead/view';
import { canonicalFrames, latestObservation, withRecordedEvidence } from './rideahead-fixtures';

const withObservation = () => canonicalFrames().find((frame) => latestObservation(frame))!;

describe('road view for the current observation', () => {
  it('plays a cached recorded clip with the exact demo label, verdict and rationale', () => {
    const view = roadViewFor(toSnapshotView(withRecordedEvidence(withObservation())));
    expect(view.kind).toBe('recorded');
    if (view.kind !== 'recorded') return;
    expect(view.label).toBe('Recorded footage · cached Cosmos check');
    expect(view.verdictLabel).toBe('Cosmos verdict: Supported');
    expect(view.rationale).toBe('Parked car occupies the bike lane.');
    expect(view.src).toBe('/api/archive/media?source=test%2Fclip.mp4');
    expect([view.startS, view.endS]).toEqual([2, 7]);
    expect(view.trust.kind).toBe('supported');
  });
  it('labels live and fixture verification distinctly', () => {
    const live = roadViewFor(
      toSnapshotView(withRecordedEvidence(withObservation(), { source: 'live_model' })),
    );
    const fixture = roadViewFor(
      toSnapshotView(withRecordedEvidence(withObservation(), { source: 'fixture' })),
    );
    expect(live.kind === 'recorded' && live.label).toBe('Recorded footage · live Cosmos check');
    expect(fixture.kind === 'recorded' && fixture.label).toBe(
      'Recorded footage · fixture check · no Cosmos call',
    );
    expect(recordedLabel(null)).toBe('Recorded footage · no Cosmos check');
    expect(verdictLabel(null)).toBe('Not verified');
  });
  it('never makes synthetic or unsafe media playable', () => {
    const synthetic = withRecordedEvidence(withObservation());
    latestObservation(synthetic)!.evidence[0].provenance = 'synthetic';
    expect(roadViewFor(toSnapshotView(synthetic)).kind).toBe('synthetic');
    const scenario = withRecordedEvidence(withObservation());
    latestObservation(scenario)!.source = 'synthetic_scenario';
    expect(roadViewFor(toSnapshotView(scenario)).kind).toBe('synthetic');
    const unsafe = withRecordedEvidence(withObservation());
    latestObservation(unsafe)!.evidence[0].media_ref = 'https://upstream.example/clip?token=x';
    expect(roadViewFor(toSnapshotView(unsafe)).kind).toBe('unavailable');
  });
  it('never reveals a future observation and is unavailable before any observation', () => {
    const future = withRecordedEvidence(withObservation());
    const recorded = latestObservation(future)!;
    future.replay_time_s = recorded.session_time_s - 1;
    const view = roadViewFor(toSnapshotView(future));
    expect(view.key?.startsWith(recorded.observation_id) ?? false).toBe(false);
    const empty = canonicalFrames()[0];
    empty.observations = [];
    expect(roadViewFor(toSnapshotView(empty)).kind).toBe('unavailable');
  });
  it('follows the generated frames: recorded clips play, synthetic events never do', () => {
    let recorded = 0;
    for (const frame of canonicalFrames()) {
      const current = latestObservation(frame);
      const view = roadViewFor(toSnapshotView(frame));
      if (!current) {
        expect(view.kind).toBe('unavailable');
        continue;
      }
      const evidence = current.evidence[0];
      if (current.source === 'synthetic_scenario' || evidence.provenance === 'synthetic') {
        expect(view.kind).toBe('synthetic');
        expect(view.label).toMatch(/^Synthetic (event|clearance) · not recorded footage$/);
        if (current.assertion === 'clear') expect(view.label).toContain('clearance');
      } else if (safeMediaPath(evidence.media_ref ?? null)) {
        recorded += 1;
        expect(view.kind).toBe('recorded');
        if (view.kind === 'recorded') {
          expect(view.label).toBe(recordedLabel(current.verification?.source ?? null));
          expect(view.rationale).toBe(current.verification?.rationale || null);
        }
      }
    }
    // The regenerated NYC fixture has at least one frame on a recorded observation.
    expect(recorded).toBeGreaterThan(0);
  });
  it('validates clip windows from server offsets', () => {
    expect(clipWindow(2, 7)).toEqual({ startS: 2, endS: 7 });
    expect(clipWindow(-1, 5)).toEqual({ startS: 0, endS: 5 });
    expect(clipWindow(4, 4)).toEqual({ startS: 4, endS: null });
    expect(clipWindow(Number.NaN, Number.NaN)).toEqual({ startS: 0, endS: null });
  });
});

describe('claim trust layer', () => {
  const evidenceOf = (frame: ReturnType<typeof withRecordedEvidence>) =>
    toSnapshotView(frame).evidence.find(
      (item) => item.observationId === latestObservation(frame)!.observation_id,
    )!;
  it('shows a verifier-contradicted recorded claim as rejected but playable', () => {
    const frame = withRecordedEvidence(withObservation(), {
      verdict: 'contradicted',
      rationale: 'The green lane is clear; the SUV is in the buffer.',
    });
    latestObservation(frame)!.support = 'uncertain';
    const trust = claimTrust(evidenceOf(frame));
    expect(trust).toMatchObject({ kind: 'rejected', label: 'Claim rejected by verification' });
    expect(trust.playable).toBe(true);
  });
  it('treats a server review outcome of contradicted as rejected', () => {
    const frame = withRecordedEvidence(withObservation());
    latestObservation(frame)!.support = 'contradicted';
    expect(claimTrust(evidenceOf(frame)).kind).toBe('rejected');
  });
  it('labels supported and inconclusive claims distinctly', () => {
    const supported = claimTrust(evidenceOf(withRecordedEvidence(withObservation())));
    const unclear = withRecordedEvidence(withObservation(), { verdict: 'unclear' });
    latestObservation(unclear)!.support = 'uncertain';
    const inconclusive = claimTrust(evidenceOf(unclear));
    expect(supported.label).toBe('Claim supported by verification');
    expect(inconclusive.label).toBe('Verification inconclusive');
    expect(new Set([supported.kind, inconclusive.kind, 'rejected']).size).toBe(3);
  });
  it('never makes synthetic evidence playable and labels clearance explicitly', () => {
    const last = canonicalFrames().at(-1)!;
    for (const item of toSnapshotView(last).evidence) {
      const trust = claimTrust(item);
      if (item.provenanceKind !== 'synthetic') continue;
      expect(trust.kind).toBe('synthetic');
      expect(trust.playable).toBe(false);
      expect(trust.label).toBe(
        item.assertion === 'clear'
          ? 'Synthetic clearance · not recorded footage'
          : 'Synthetic event · not recorded footage',
      );
    }
  });
  it('classifies the generated recorded claims from the server support field', () => {
    for (const item of toSnapshotView(canonicalFrames().at(-1)!).evidence) {
      if (item.provenanceKind === 'synthetic') continue;
      const trust = claimTrust(item);
      expect(trust.playable).toBe(safeMediaPath(item.mediaPath) !== null);
      if (item.support === 'contradicted') expect(trust.kind).toBe('rejected');
    }
  });
});
