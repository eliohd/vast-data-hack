import { safeMediaPath, type EvidenceView } from './view';

export type ClaimTrustKind = 'synthetic' | 'rejected' | 'supported' | 'inconclusive' | 'unverified';
export type ClaimTrust = {
  kind: ClaimTrustKind;
  label: string;
  /** Server values behind the label, shown next to it (never re-derived). */
  detail: string;
  /** Recorded footage behind the app media proxy; synthetic evidence is never playable. */
  playable: boolean;
};

/** Prominent label for synthetic scenario events; clearance events say so explicitly. */
export function syntheticLabel(assertion: EvidenceView['assertion'] | null | undefined): string {
  return assertion === 'clear'
    ? 'Synthetic clearance · not recorded footage'
    : 'Synthetic event · not recorded footage';
}

export function isSyntheticEvidence(evidence: EvidenceView): boolean {
  return (
    evidence.provenanceKind === 'synthetic' || evidence.observationSource === 'synthetic_scenario'
  );
}

/** Only real recorded footage behind the app media proxy may ever be playable. */
export function isPlayableRecorded(evidence: EvidenceView): boolean {
  return (
    !isSyntheticEvidence(evidence) &&
    (evidence.provenanceKind === 'recorded' || evidence.provenanceKind === 'cached_recorded') &&
    safeMediaPath(evidence.mediaPath) !== null
  );
}

const verdictText = { supported: 'supported', contradicted: 'contradicted', unclear: 'unclear' };

/**
 * Trust layer for one claim, from the server's `support` outcome and the clip verification.
 * A claim is rejected when the server's combined review or the verifier contradicts it.
 */
export function claimTrust(evidence: EvidenceView): ClaimTrust {
  if (isSyntheticEvidence(evidence))
    return {
      kind: 'synthetic',
      label: syntheticLabel(evidence.assertion),
      detail: evidence.observationLabel ?? 'Synthetic scenario event',
      playable: false,
    };
  const verdict = evidence.verification?.verdict;
  const detail = [
    `Review outcome: ${evidence.support}`,
    verdict ? `verifier verdict: ${verdictText[verdict]}` : 'no clip verification',
  ].join(' · ');
  const playable = isPlayableRecorded(evidence);
  if (evidence.support === 'contradicted' || verdict === 'contradicted')
    return { kind: 'rejected', label: 'Claim rejected by verification', detail, playable };
  if (evidence.support === 'supported' && verdict === 'supported')
    return { kind: 'supported', label: 'Claim supported by verification', detail, playable };
  if (!verdict && evidence.support !== 'uncertain')
    return { kind: 'unverified', label: 'Claim not verified', detail, playable };
  return { kind: 'inconclusive', label: 'Verification inconclusive', detail, playable };
}
