import {
  Check,
  CircleHelp,
  Clock,
  OctagonAlert,
  TriangleAlert,
  type LucideProps,
} from 'lucide-react';
import { lifecycleStyles, type LifecycleIconName } from '@/lib/rideahead/lifecycle';
import type { HazardState } from '@/lib/rideahead/view';

const icons = { TriangleAlert, OctagonAlert, Clock, CircleHelp, Check } satisfies Record<
  LifecycleIconName,
  unknown
>;

export function LifecycleIcon({ state, ...props }: { state: HazardState } & LucideProps) {
  const Icon = icons[lifecycleStyles[state].icon];
  return <Icon aria-hidden="true" {...props} />;
}

/**
 * The lifecycle marker symbol, centred on (0, 0) in SVG user units. Shared by map markers and the
 * legend so both always show the same colour, outline pattern and icon.
 */
export function HazardGlyph({ state, radius }: { state: HazardState; radius: number }) {
  const style = lifecycleStyles[state];
  const icon = Math.round(radius * 1.1);
  return (
    <>
      <circle r={radius + 2} fill="white" opacity={0.9} />
      <circle
        r={radius}
        fill={style.fill}
        fillOpacity={style.opacity}
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dash}
        strokeLinecap={style.dash ? 'round' : undefined}
      />
      <LifecycleIcon
        state={state}
        x={-icon / 2}
        y={-icon / 2}
        width={icon}
        height={icon}
        color={style.iconColor}
        strokeWidth={2.4}
      />
    </>
  );
}
