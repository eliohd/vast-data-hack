/** Presentation models, not REST contracts. Map generated Agent A types here at integration. */
export type Point = { lat: number; lon: number };
export type HazardState = 'observed' | 'confirmed' | 'stale' | 'disputed' | 'cleared';
export type RouteView = {
  id: string;
  name: string;
  points: Point[];
  durationS: number | null;
  distanceM: number | null;
  provenance: string;
  warnings: string[];
};
export type EvidenceView = {
  id: string;
  source: string;
  provenance: string;
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
  riders: { id: string; name: string; simulated: boolean; point: Point | null }[];
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
  }[];
  evidence: EvidenceView[];
  routes: RouteView[];
  decision: {
    riderId: string;
    action: 'continue' | 'heads_up' | 'slow' | 'wait' | 'reroute' | 'unavailable';
    reason: string;
    selectedRouteId: string | null;
    delayS: number | null;
    detourS: number | null;
    changed: boolean;
    evidenceIds: string[];
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

/** Local equirectangular projection for a small route overview, not route computation. */
export function mapProjection(points: Point[]) {
  const valid = points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180,
  );
  if (!valid.length) return null;
  const cosLat = Math.cos((valid[0].lat * Math.PI) / 180);
  const xs = valid.map((p) => p.lon * cosLat);
  const ys = valid.map((p) => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(660 / Math.max(maxX - minX, 0.0001), 360 / Math.max(maxY - minY, 0.0001));
  return (p: Point): [number, number] => [
    350 + (p.lon * cosLat - (minX + maxX) / 2) * scale,
    210 - (p.lat - (minY + maxY) / 2) * scale,
  ];
}
