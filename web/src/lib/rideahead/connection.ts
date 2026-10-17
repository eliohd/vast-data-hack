import { api, type Schemas } from '@/lib/api/client';
import type { Point, RideAheadConnection, SnapshotView } from './view';

const provenance = {
  recorded: 'Recorded footage',
  cached_recorded: 'Cached recorded evidence',
  synthetic: 'Synthetic development fixture',
};
const names = {
  vast: 'VAST',
  cosmos: 'Cosmos',
  yolo: 'YOLO11',
  wandb_inference: 'W&B Inference',
  weave: 'Weave',
  routing: 'Bicycle routing',
};
const statuses = {
  connected: 'Connected',
  configured: 'Configured · not verified',
  cached: 'Cached',
  fixture: 'Fixture',
  unavailable: 'Unavailable',
  not_configured: 'Not configured',
};

/** Provenance only: true when every supplied observation is a synthetic scenario/fixture event. */
function isSyntheticOnly(observations: Schemas['Observation'][]): boolean {
  return (
    observations.length > 0 &&
    observations.every(
      (observation) =>
        observation.source === 'synthetic_scenario' ||
        (observation.evidence.length > 0 &&
          observation.evidence.every((item) => item.provenance === 'synthetic')),
    )
  );
}

export function toSnapshotView(source: Schemas['SessionSnapshot']): SnapshotView {
  const observations = source.observations.filter(
    (item) => item.session_time_s <= source.replay_time_s,
  );
  const evidence = new Map(
    observations.flatMap((observation) =>
      observation.evidence.map((item) => [item.evidence_id, { observation, item }] as const),
    ),
  );
  const decision =
    source.decisions.find((item) =>
      source.riders.some((rider) => rider.rider_id === item.rider_id && rider.simulated),
    ) ?? source.decisions[0];
  // The server's own history supplies the previous decision; the browser never re-derives it.
  const previousDecision = decision
    ? (source.decision_history ?? [])
        .filter(
          (item) =>
            item.rider_id === decision.rider_id &&
            item.decision_id !== decision.decision_id &&
            (item.session_time_s < decision.session_time_s ||
              (item.session_time_s === decision.session_time_s &&
                item.revision < decision.revision)),
        )
        .reduce<Schemas['Decision'] | null>(
          (latest, item) =>
            !latest ||
            item.session_time_s > latest.session_time_s ||
            (item.session_time_s === latest.session_time_s && item.revision > latest.revision)
              ? item
              : latest,
          null,
        )
    : null;
  const latestVerified = [...observations]
    .reverse()
    .find((observation) => observation.verification);
  const currentObservation = observations.reduce<Schemas['Observation'] | null>(
    (latest, item) => (!latest || item.session_time_s >= latest.session_time_s ? item : latest),
    null,
  );
  function verificationFor(
    observation: Schemas['Observation'],
    item: Schemas['Evidence'],
  ): SnapshotView['evidence'][number]['verification'] {
    const verification = observation.verification;
    if (!verification) return null;
    const matchesOther =
      verification.evidence_id !== item.evidence_id &&
      observation.evidence.some((other) => other.evidence_id === verification.evidence_id);
    if (matchesOther) return null;
    return {
      evidenceId: verification.evidence_id,
      verdict: verification.verdict,
      rationale: verification.rationale ?? '',
      source: verification.source ?? 'fixture',
      model: verification.model ?? null,
    };
  }
  function point(location: Schemas['LocationEstimate']): Point | null {
    return location.lat != null && location.lon != null
      ? { lat: location.lat, lon: location.lon }
      : null;
  }
  return {
    id: source.session_id,
    revision: source.revision,
    timeS: source.replay_time_s,
    endS: source.duration_s,
    cosmos: {
      text:
        latestVerified?.verification?.rationale ||
        'Waiting for a Cosmos observation of the road ahead.',
      source: latestVerified?.verification?.source ?? 'unavailable',
      timeS: latestVerified?.session_time_s ?? null,
    },
    currentObservation: currentObservation
      ? {
          id: currentObservation.observation_id,
          timeS: currentObservation.session_time_s,
          label: currentObservation.label ?? null,
          source: currentObservation.source,
          evidenceIds: currentObservation.evidence.map((item) => item.evidence_id),
          assertion: currentObservation.assertion,
        }
      : null,
    provenance: (source.labels ?? []).join(' · ') || 'Provenance not supplied',
    locationLabel:
      (source.labels ?? [])
        .filter((label) => /location|route|fixture|synthetic|anchor/i.test(label))
        .join(' · ') || 'Location provenance not supplied',
    riders: source.riders.map((rider) => ({
      id: rider.rider_id,
      name: rider.label,
      simulated: rider.simulated,
      point: rider.position ?? null,
    })),
    hazards: source.hazards.map((hazard) => ({
      id: hazard.hazard_id,
      title:
        source.config.hazard_types?.[hazard.hazard_type]?.display_name ??
        hazard.hazard_type.replaceAll('_', ' '),
      state: hazard.state,
      point: point(hazard.location),
      locationMethod: `${hazard.location.method.replaceAll('_', ' ')}${hazard.location.notes ? ` · ${hazard.location.notes}` : ''}`,
      uncertaintyM: hazard.location.uncertainty_m ?? null,
      lastSupportedS: hazard.last_supported_s,
      evidenceIds: [
        ...new Set(
          observations
            .filter((observation) => hazard.observation_ids.includes(observation.observation_id))
            .flatMap((observation) => observation.evidence.map((item) => item.evidence_id)),
        ),
      ],
      strength: hazard.evidence_strength ?? 'unknown',
      synthetic: isSyntheticOnly(
        observations.filter((observation) =>
          hazard.observation_ids.includes(observation.observation_id),
        ),
      ),
      impact: hazard.impact ?? 'unknown',
    })),
    evidence: [...evidence.values()].map(({ observation, item }) => ({
      id: item.evidence_id,
      source: `${item.ride_id} / ${item.segment_id}`,
      provenance: `${provenance[item.provenance]} · ${observation.label ?? observation.source}`,
      provenanceKind: item.provenance,
      observationId: observation.observation_id,
      observationSource: observation.source,
      observationLabel: observation.label ?? null,
      support: observation.support,
      assertion: observation.assertion,
      verification: verificationFor(observation, item),
      mediaPath: item.provenance === 'synthetic' ? null : (item.media_ref ?? null),
      clipStartS: item.clip_start_s,
      clipEndS: item.clip_end_s,
      rideOffsetS: item.ride_offset_s,
      recordedAt: item.recorded_at ?? null,
      description: observation.description,
      modelDetails: [
        `Extraction: ${item.model ?? 'unknown model'} · prompt ${item.prompt_version ?? 'unknown'}`,
        `Verification: ${observation.verification?.model ?? 'unknown model'} · prompt ${observation.verification?.prompt_version ?? 'unknown'}`,
        `Object evidence: ${
          Object.entries(item.object_counts ?? {})
            .map(([name, count]) => `${name}: ${count}`)
            .join(', ') || 'not supplied'
        }. Object presence alone does not establish blockage.`,
      ],
      assessment: observation.verification
        ? `${observation.verification.verdict} · ${observation.verification.source ?? 'unknown'} · ${observation.verification.rationale ?? ''}`
        : `No video verification supplied · extraction support: ${observation.support}`,
    })),
    routes: source.routes.map((route) => ({
      id: route.route_id,
      name:
        route.role === 'primary'
          ? 'Original route'
          : route.role === 'detour'
            ? 'Detour'
            : 'Alternative route',
      points: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
      durationS: route.duration_s,
      distanceM: route.distance_m,
      provenance: `${route.provenance} · ${route.provider} · ${route.profile}`,
      warnings: [route.label ?? '', ...(route.warnings ?? [])].filter(Boolean),
    })),
    decision: decision
      ? {
          id: decision.decision_id,
          revision: decision.revision,
          timeS: decision.session_time_s,
          riderId: decision.rider_id,
          action: decision.action,
          reason: decision.reason,
          selectedRouteId: decision.selected_route_id ?? null,
          delayS: decision.estimated_delay_s ?? null,
          detourS: decision.detour_cost_s ?? null,
          arrivalS: decision.arrival_in_s ?? null,
          changed: decision.changed ?? false,
          previous: previousDecision
            ? {
                action: previousDecision.action,
                selectedRouteId: previousDecision.selected_route_id ?? null,
              }
            : null,
          evidenceIds: decision.evidence_ids ?? [],
          syntheticBasis: isSyntheticOnly(
            observations.filter((observation) =>
              observation.evidence.some((item) =>
                (decision.evidence_ids ?? []).includes(item.evidence_id),
              ),
            ),
          ),
          assumptions: decision.assumptions ?? [],
        }
      : null,
    config: {
      shortRadiusM: source.config.share_radius_m ?? 200,
      planningRadiusM: source.config.planning_radius_m ?? 2000,
    },
    integrations: source.integrations.map((item) => ({
      name: names[item.name],
      status: statuses[item.state],
      detail: item.detail ?? '',
    })),
  };
}

function failure(response: Response): Error {
  return new Error(
    response.status === 401
      ? 'A valid demo key is required. Open the shared demo link with its key.'
      : response.status === 429
        ? 'Too many requests. Pause replay and retry shortly.'
        : `RideAhead server returned ${response.status}. Retry the connection.`,
  );
}

export function createRideAheadConnection(
  rideId?: string,
  scenarioId?: string,
): RideAheadConnection {
  let sessionId: string | null = null;
  let creating: Promise<string> | null = null;
  const signal = (external?: AbortSignal) =>
    external ? AbortSignal.any([external, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  async function ensureSession(external?: AbortSignal): Promise<string> {
    if (sessionId) return sessionId;
    if (!creating)
      creating = (async () => {
        try {
          const result = await api.POST('/api/rideahead/sessions', {
            body: { ride_id: rideId, ...(scenarioId ? { scenario_id: scenarioId } : {}) },
            signal: signal(external),
          });
          if (!result.data) throw failure(result.response);
          sessionId = result.data.session_id;
          return sessionId;
        } finally {
          creating = null;
        }
      })();
    return creating;
  }
  return {
    async read(external) {
      const id = await ensureSession(external);
      const result = await api.GET('/api/rideahead/sessions/{session_id}', {
        params: { path: { session_id: id } },
        signal: signal(external),
      });
      if (!result.data) {
        if (result.response.status === 404) sessionId = null;
        throw failure(result.response);
      }
      return toSnapshotView(result.data);
    },
    async advance(timeS) {
      const id = await ensureSession();
      const result = await api.POST('/api/rideahead/sessions/{session_id}/advance', {
        params: { path: { session_id: id } },
        body: { to_s: timeS },
        signal: signal(),
      });
      if (!result.data) throw failure(result.response);
      return toSnapshotView(result.data);
    },
    async configure(config) {
      const id = await ensureSession();
      const result = await api.PATCH('/api/rideahead/sessions/{session_id}/config', {
        params: { path: { session_id: id } },
        body: { share_radius_m: config.shortRadiusM, planning_radius_m: config.planningRadiusM },
        signal: signal(),
      });
      if (!result.data) throw failure(result.response);
      return toSnapshotView(result.data);
    },
  };
}
