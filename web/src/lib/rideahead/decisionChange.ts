import { actionLabels, timeLabel, type RouteView, type SnapshotView } from './view';

type Decision = NonNullable<SnapshotView['decision']>;

/** Whole seconds, e.g. `45 s`, `5 min 17 s`. Sign is dropped; callers word direction. */
export function formatDuration(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} s`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

const usable = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

/** Server `detour_cost_s`, displayed unchanged apart from rounding. */
export function formatDetour(seconds: number | null | undefined): string | null {
  if (!usable(seconds)) return null;
  const rounded = Math.round(seconds);
  if (rounded > 0) return `+${formatDuration(rounded)} detour`;
  if (rounded < 0) return `${formatDuration(rounded)} faster`;
  return 'No extra detour time';
}

/** Server `arrival_in_s` is the estimated time until the hazard, not until the destination. */
export function formatArrival(seconds: number | null | undefined): string | null {
  if (!usable(seconds)) return null;
  if (Math.round(seconds) <= 0) return 'Reaching the report now';
  return `Report ahead in ~${formatDuration(seconds)}`;
}

export function formatDelay(seconds: number | null | undefined): string | null {
  if (!usable(seconds)) return null;
  return Math.round(seconds) <= 0 ? 'No expected delay' : `~${formatDuration(seconds)} delay`;
}

export type DecisionChange = {
  key: string;
  timeS: number;
  kind: 'route' | 'action';
  /** Short badge text shown on the decision card. */
  title: string;
  /** Card event line without the reason, e.g. `t=3:20 Route changed: Original route → Detour`. */
  summary: string;
  /** Event-log line, e.g. `t=3:20 Route changed: Original route → Detour · reason`. */
  line: string;
};

export function decisionKey(decision: Decision): string {
  return `${decision.id}:${decision.revision}`;
}

function routeName(routes: RouteView[], id: string | null): string {
  if (!id) return 'No route';
  return routes.find((route) => route.id === id)?.name ?? 'Unlisted route';
}

/**
 * Wording for a server-flagged change. Only `decision.changed` (set by the runtime) marks a change;
 * the browser never decides whether the recommendation changed. The initial recommendation (no
 * previous server decision) is not announced.
 */
export function describeDecisionChange(
  decision: SnapshotView['decision'],
  routes: RouteView[],
): DecisionChange | null {
  if (!decision?.changed || !decision.previous) return null;
  const { previous } = decision;
  const at = `t=${timeLabel(decision.timeS)}`;
  const routeChanged = previous.selectedRouteId !== decision.selectedRouteId;
  const from = routeChanged
    ? routeName(routes, previous.selectedRouteId)
    : actionLabels[previous.action];
  const to = routeChanged
    ? routeName(routes, decision.selectedRouteId)
    : actionLabels[decision.action];
  const title = routeChanged
    ? 'Route changed'
    : from === to
      ? 'Recommendation updated'
      : 'Recommendation changed';
  const basis = decision.syntheticBasis ? ' · based on a SYNTHETIC event' : '';
  const summary =
    (!routeChanged && from === to ? `${at} ${title}: ${to}` : `${at} ${title}: ${from} → ${to}`) +
    basis;
  return {
    key: decisionKey(decision),
    timeS: decision.timeS,
    kind: routeChanged ? 'route' : 'action',
    title,
    summary,
    line: `${summary} · ${decision.reason}`,
  };
}

export type DecisionTracker = { lastKey: string | null; lastTimeS: number | null };
export const initialDecisionTracker: DecisionTracker = { lastKey: null, lastTimeS: null };

/**
 * Presentation de-duplication: report each server change once, however often it is polled.
 * Rewinding the replay clock resets the tracker so replays announce changes again.
 */
export function trackDecisionChange(
  state: DecisionTracker,
  snapshot: Pick<SnapshotView, 'timeS' | 'decision' | 'routes'>,
): { state: DecisionTracker; change: DecisionChange | null } {
  const rewound = state.lastTimeS != null && snapshot.timeS < state.lastTimeS;
  const lastKey = rewound ? null : state.lastKey;
  const change = describeDecisionChange(snapshot.decision, snapshot.routes);
  if (!change || change.key === lastKey)
    return { state: { lastKey, lastTimeS: snapshot.timeS }, change: null };
  return { state: { lastKey: change.key, lastTimeS: snapshot.timeS }, change };
}
