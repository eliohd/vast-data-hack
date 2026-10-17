import { claimTrust, isPlayableRecorded, syntheticLabel, type ClaimTrust } from './trust';
import { safeMediaPath, type SnapshotView, type VerificationView } from './view';

export type RoadView =
  | {
      kind: 'recorded';
      /** Changes when replay reaches a different observation/clip; drives autoplay once. */
      key: string;
      /** Safe same-origin media path (demo key is appended at render time). */
      src: string;
      startS: number;
      endS: number | null;
      label: string;
      verdictLabel: string;
      verdict: VerificationView['verdict'] | null;
      rationale: string | null;
      model: string | null;
      /** Trust layer for the claim shown in the clip (may be rejected despite the footage). */
      trust: ClaimTrust;
      observationLabel: string | null;
      timeS: number;
    }
  | {
      kind: 'synthetic';
      key: string;
      label: string;
      detail: string;
      timeS: number;
    }
  | { kind: 'unavailable'; key: string | null; label: string; detail: string };

const verdicts = { supported: 'Supported', contradicted: 'Contradicted', unclear: 'Unclear' };

/** Exact demo wording for cached Cosmos verification; other sources are labelled distinctly. */
export function recordedLabel(source: VerificationView['source'] | null): string {
  switch (source) {
    case 'cached_model':
      return 'Recorded footage · cached Cosmos check';
    case 'live_model':
      return 'Recorded footage · live Cosmos check';
    case 'fixture':
      return 'Recorded footage · fixture check · no Cosmos call';
    default:
      return 'Recorded footage · no Cosmos check';
  }
}

export function verdictLabel(verification: VerificationView | null): string {
  if (!verification) return 'Not verified';
  const prefix = verification.source === 'fixture' ? 'Fixture verdict' : 'Cosmos verdict';
  return `${prefix}: ${verdicts[verification.verdict]}`;
}

/** Clip window from server offsets; invalid offsets play from the start with no end. */
export function clipWindow(start: number, end: number): { startS: number; endS: number | null } {
  const startS = Number.isFinite(start) && start >= 0 ? start : 0;
  const endS = Number.isFinite(end) && end > startS ? end : null;
  return { startS, endS };
}

/** Road view for the current server observation. Pure presentation: no hazard or route logic. */
export function roadViewFor(snapshot: SnapshotView): RoadView {
  const observation = snapshot.currentObservation;
  if (!observation || observation.timeS > snapshot.timeS)
    return {
      kind: 'unavailable',
      key: null,
      label: 'No recorded clip for this moment',
      detail: 'Recorded footage appears here when replay reaches an observation with a clip.',
    };
  const evidence = snapshot.evidence.filter((item) => item.observationId === observation.id);
  const playable = evidence.filter(isPlayableRecorded);
  const chosen = playable.find((item) => item.verification) ?? playable[0];
  if (chosen) {
    const src = safeMediaPath(chosen.mediaPath)!;
    const verification = chosen.verification;
    return {
      kind: 'recorded',
      key: `${observation.id}:${chosen.id}`,
      src,
      ...clipWindow(chosen.clipStartS, chosen.clipEndS),
      label: recordedLabel(verification?.source ?? null),
      verdictLabel: verdictLabel(verification),
      verdict: verification?.verdict ?? null,
      rationale: verification?.rationale || null,
      model: verification?.model ?? null,
      trust: claimTrust(chosen),
      observationLabel: observation.label,
      timeS: observation.timeS,
    };
  }
  const synthetic =
    observation.source === 'synthetic_scenario' ||
    evidence.some((item) => item.provenanceKind === 'synthetic');
  if (synthetic)
    return {
      kind: 'synthetic',
      key: observation.id,
      label: syntheticLabel(observation.assertion),
      detail: observation.label ?? 'Development fixture',
      timeS: observation.timeS,
    };
  return {
    kind: 'unavailable',
    key: observation.id,
    label: 'Recorded evidence without a playable clip',
    detail: 'The server did not supply an app media path for this observation.',
  };
}
