import { BotAvatar } from 'bot-avatars';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerDownLeft,
  CornerDownRight,
  Flag,
  RefreshCw,
} from 'lucide-react';
import { journeyFor } from '@/lib/rideahead/journey';
import { actionLabels, type SnapshotView } from '@/lib/rideahead/view';
import type { DecisionChange } from '@/lib/rideahead/decisionChange';
import type { CameraInference } from './VideoWidget';

export default function GuideBubble({
  snapshot,
  active,
  updating,
  change,
  highlight,
  inference,
  onEvidence,
}: {
  snapshot: SnapshotView | null;
  active: boolean;
  updating: boolean;
  change: DecisionChange | null;
  highlight: boolean;
  inference: CameraInference | null;
  onEvidence: () => void;
}) {
  const journey = journeyFor(snapshot, Date.now());
  const maneuver = journey.maneuver;
  const Direction = maneuver.includes('left')
    ? maneuver.includes('slight')
      ? ArrowUpLeft
      : CornerDownLeft
    : maneuver.includes('right')
      ? maneuver.includes('slight')
        ? ArrowUpRight
        : CornerDownRight
      : maneuver === 'arrive'
        ? Flag
        : ArrowUp;
  const decision = snapshot?.decision;
  const advisory = decision && decision.action !== 'continue';
  return (
    <div className={`ra-guide ${highlight ? 'is-changed' : ''}`} data-map-chrome>
      <div className="ra-guide-mascot">
        <BotAvatar
          type="clover"
          color="#9cbb68"
          size={65}
          state={updating ? 'working' : 'default'}
          interactive={false}
          theme="light"
        />
      </div>
      <button
        className="ra-guide-bubble ra-glass"
        onClick={onEvidence}
        aria-label="Navigation guidance and hazard evidence"
      >
        <span className="ra-guide-eyebrow">
          {updating
            ? 'Updating guidance'
            : active
              ? 'Clover · your ride companion'
              : 'Clover · ready when you are'}
        </span>
        <strong>
          <Direction size={20} aria-hidden="true" />
          {active ? journey.instruction : 'Where are we riding?'}
        </strong>
        {active && journey.nextDistance && (
          <span className="ra-guide-distance">
            In {journey.nextDistance}
            {journey.street ? ` · ${journey.street}` : ''}
          </span>
        )}
        {active && !journey.hasDirections && (
          <span className="ra-guide-note">
            {snapshot ? 'Turn instructions unavailable' : 'Connecting to your ride…'}
          </span>
        )}
        {active && advisory && (
          <span className="ra-guide-advisory">
            {actionLabels[decision.action]} · {decision.reason}
          </span>
        )}
        {active && decision?.syntheticBasis && (
          <span className="ra-synthetic-chip">SYNTHETIC EVENT</span>
        )}
        {inference && (
          <span className="ra-guide-note">
            {inference.label} · {inference.text}
          </span>
        )}
        {change && (
          <span className="ra-guide-change" aria-live="polite">
            <RefreshCw size={11} />
            {change.title}
          </span>
        )}
      </button>
    </div>
  );
}
