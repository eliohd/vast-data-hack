import type { Schemas } from '@/lib/api/client';

/** Presentation models, not REST contracts. Map generated Agent A types here at integration. */
export type Point = { lat: number; lon: number };
/** Driven by the generated enum, so a new server state fails type checks until it is styled. */
export type HazardState = Schemas['Hazard']['state'];
export type DecisionAction = Schemas['Decision']['action'];
export type RouteView = {
  id: string;
  name: string;
  points: Point[];
  durationS: number | null;
  distanceM: number | null;
  provenance: string;
  warnings: string[];
  steps?: Schemas['RouteStep'][];
};
export type VerificationView = {
  evidenceId: string;
  verdict: Schemas['Verification']['verdict'];
  rationale: string;
  source: Schemas['Verification']['source'];
  model: string | null;
};
export type EvidenceView = {
  id: string;
  source: string;
  provenance: string;
  provenanceKind: Schemas['Evidence']['provenance'];
  observationId: string;
  observationSource: Schemas['Observation']['source'];
  observationLabel: string | null;
  /** Server's combined trust outcome for the claim (caption + verification + review). */
  support: Schemas['Observation']['support'];
  assertion: Schemas['Observation']['assertion'];
  verification: VerificationView | null;
  mediaPath: string | null;
  clipStartS: number;
  clipEndS: number;
  rideOffsetS: number;
  recordedAt: string | null;
  description: string;
  assessment: string;
  modelDetails: string[];
};
export type SnapshotView = {
  id: string;
  revision: number;
  timeS: number;
  endS: number;
  provenance: string;
  locationLabel: string;
  cosmos: {
    text: string;
    source: 'live_model' | 'cached_model' | 'fixture' | 'unavailable';
    timeS: number | null;
  };
  /** Latest observation revealed by the server replay clock (no browser inference). */
  currentObservation: {
    id: string;
    timeS: number;
    label: string | null;
    source: Schemas['Observation']['source'];
    evidenceIds: string[];
    assertion: Schemas['Observation']['assertion'];
  } | null;
  riders: {
    id: string;
    name: string;
    simulated: boolean;
    point: Point | null;
    activeRouteId?: string | null;
    remainingDistanceM?: number | null;
    remainingDurationS?: number | null;
    nextStepIndex?: number | null;
    distanceToNextStepM?: number | null;
    status?: Schemas['Rider']['status'];
  }[];
  hazards: {
    id: string;
    title: string;
    state: HazardState;
    point: Point | null;
    locationMethod: string;
    uncertaintyM: number | null;
    lastSupportedS: number;
    evidenceIds: string[];
    strength: string;
    impact: string;
    /** Every supporting observation is a labelled synthetic scenario/fixture event. */
    synthetic: boolean;
  }[];
  evidence: EvidenceView[];
  routes: RouteView[];
  decision: {
    id: string;
    revision: number;
    timeS: number;
    riderId: string;
    action: DecisionAction;
    reason: string;
    selectedRouteId: string | null;
    delayS: number | null;
    detourS: number | null;
    /** Server estimate of seconds until the hazard (not until the destination). */
    arrivalS: number | null;
    changed: boolean;
    /** Previous server decision for this rider, from decision_history. */
    previous: { action: DecisionAction; selectedRouteId: string | null } | null;
    evidenceIds: string[];
    /** The decision's evidence is entirely synthetic scenario/fixture evidence. */
    syntheticBasis: boolean;
    assumptions: string[];
  } | null;
  config: { shortRadiusM: number; planningRadiusM: number };
  integrations: { name: string; status: string; detail: string }[];
};

/** A UI port. The server adapter must use api + generated types, never inferred endpoints. */
export interface RideAheadConnection {
  read(signal?: AbortSignal): Promise<SnapshotView>;
  advance(timeS: number): Promise<SnapshotView>;
  configure(config: SnapshotView['config']): Promise<SnapshotView>;
}

export const stateLabels: Record<HazardState, string> = {
  observed: 'Observed',
  confirmed: 'Confirmed',
  stale: 'Stale · fresh evidence needed',
  disputed: 'Disputed · conflicting evidence',
  cleared: 'Cleared · later evidence',
};

export const actionLabels: Record<DecisionAction, string> = {
  continue: 'Continue your ride',
  heads_up: 'Heads up ahead',
  slow: 'Slow down',
  wait: 'Wait before continuing',
  reroute: 'Take the alternative',
  unavailable: 'Recommendation unavailable',
};

export function timeLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** Only application media paths are playable. Reject external/token-bearing URLs. */
export function safeMediaPath(value: string | null): string | null {
  if (!value || !value.startsWith('/api/archive/media?') || value.includes('#')) return null;
  const query = new URLSearchParams(value.split('?')[1]);
  if ([...query.keys()].some((key) => key !== 'source')) return null;
  return query.get('source') ? value : null;
}
