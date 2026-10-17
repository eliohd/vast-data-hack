import { stateLabels, type HazardState } from './view';

/** Names of lucide icons used as the non-colour lifecycle cue (mapped in LifecycleIcon.tsx). */
export type LifecycleIconName = 'TriangleAlert' | 'OctagonAlert' | 'Clock' | 'CircleHelp' | 'Check';

export type LifecycleStyle = {
  /** Short legend / chapter label. */
  label: string;
  /** Full explanatory label shown on chips and to assistive technology. */
  description: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** SVG stroke-dasharray; undefined means a solid outline. */
  dash: string | undefined;
  opacity: number;
  icon: LifecycleIconName;
  iconColor: string;
  /** Class used by state chips in panels. */
  className: string;
};

/**
 * One mapping for map markers, the legend and state chips. Every state differs by colour AND by
 * icon and outline pattern, so the state never relies on colour alone.
 */
export const lifecycleStyles = {
  observed: {
    label: 'Observed',
    description: stateLabels.observed,
    fill: '#f2b84b',
    stroke: '#7a5200',
    strokeWidth: 2,
    dash: undefined,
    opacity: 1,
    icon: 'TriangleAlert',
    iconColor: '#2f2203',
    className: 'ra-observed',
  },
  confirmed: {
    label: 'Confirmed',
    description: stateLabels.confirmed,
    fill: '#d9573b',
    stroke: '#6e1e0f',
    strokeWidth: 3,
    dash: undefined,
    opacity: 1,
    icon: 'OctagonAlert',
    iconColor: '#ffffff',
    className: 'ra-confirmed',
  },
  stale: {
    label: 'Stale',
    description: stateLabels.stale,
    fill: '#efd9a6',
    stroke: '#8c6b1f',
    strokeWidth: 2,
    dash: '4 3',
    opacity: 0.78,
    icon: 'Clock',
    iconColor: '#4d3a0c',
    className: 'ra-stale',
  },
  disputed: {
    label: 'Disputed',
    description: stateLabels.disputed,
    fill: '#9c6fc6',
    stroke: '#3f1f5c',
    strokeWidth: 2.5,
    dash: '1 3',
    opacity: 1,
    icon: 'CircleHelp',
    iconColor: '#ffffff',
    className: 'ra-disputed',
  },
  cleared: {
    label: 'Cleared',
    description: stateLabels.cleared,
    fill: '#93c79d',
    stroke: '#2c6a3b',
    strokeWidth: 1.5,
    dash: undefined,
    opacity: 1,
    icon: 'Check',
    iconColor: '#123d1d',
    className: 'ra-cleared',
  },
} as const satisfies Record<HazardState, LifecycleStyle>;

/** Legend order follows the lifecycle: first report, confirmation, ageing, conflict, clearance. */
export const lifecycleOrder: HazardState[] = [
  'observed',
  'confirmed',
  'stale',
  'disputed',
  'cleared',
];

export function lifecycleStyle(state: HazardState): LifecycleStyle {
  return lifecycleStyles[state];
}
