import { useState } from 'react';
import { CircleCheck, CircleHelp, CircleX, Film, FlaskConical } from 'lucide-react';
import { withDemoKey } from '@/lib/demoKey';
import { lifecycleStyles } from '@/lib/rideahead/lifecycle';
import { recordedLabel, verdictLabel } from '@/lib/rideahead/roadView';
import { claimTrust } from '@/lib/rideahead/trust';
import { safeMediaPath, timeLabel, type SnapshotView } from '@/lib/rideahead/view';
import { LifecycleIcon } from './LifecycleIcon';

const trustIcons = {
  synthetic: FlaskConical,
  rejected: CircleX,
  supported: CircleCheck,
  inconclusive: CircleHelp,
  unverified: CircleHelp,
};

function Clip({ evidence }: { evidence: SnapshotView['evidence'][number] }) {
  const [failed, setFailed] = useState(false);
  const trust = claimTrust(evidence);
  const media = trust.playable ? safeMediaPath(evidence.mediaPath) : null;
  const synthetic = trust.kind === 'synthetic';
  const TrustIcon = trustIcons[trust.kind];
  return (
    <article className="ra-evidence-item" data-claim-trust={trust.kind}>
      <div className="ra-panel-title">
        <strong>Evidence · {evidence.id}</strong>
        <span className="ra-tag">{evidence.provenance}</span>
      </div>
      <p className={`ra-trust ra-trust-${trust.kind}`}>
        <TrustIcon size={14} aria-hidden="true" />
        <strong>{trust.label}</strong>
        <span>{trust.detail}</span>
      </p>
      {synthetic ? (
        <div className="ra-video-empty ra-evidence-synthetic">
          <FlaskConical size={18} aria-hidden="true" />
          <strong>{trust.label}</strong>
          <p>Labelled scenario event. There is no footage to play.</p>
        </div>
      ) : media && !failed ? (
        <video
          key={media}
          controls
          playsInline
          preload="metadata"
          aria-label={`Evidence clip ${evidence.id}`}
          onError={() => setFailed(true)}
          src={`${withDemoKey(media)}#t=${evidence.clipStartS},${evidence.clipEndS}`}
        />
      ) : (
        <div className="ra-video-empty" role={failed ? 'status' : undefined}>
          <Film size={18} aria-hidden="true" />
          <strong>{failed ? 'Clip playback failed' : 'No playable recorded clip'}</strong>
          <p>
            {failed
              ? 'The clip may have expired or require access. Retry after refreshing the session.'
              : 'The server did not supply an app media path for this recorded evidence.'}
          </p>
        </div>
      )}
      {!synthetic && (
        <p className="ra-evidence-check">
          <strong>{recordedLabel(evidence.verification?.source ?? null)}</strong> ·{' '}
          {verdictLabel(evidence.verification)}
          {evidence.verification?.rationale ? ` · ${evidence.verification.rationale}` : ''}
        </p>
      )}
      <p>{evidence.description}</p>
      <details>
        <summary>Models & object evidence</summary>
        {evidence.modelDetails.map((detail) => (
          <p className="ra-subtle" key={detail}>
            {detail}
          </p>
        ))}
      </details>
      <dl className="ra-facts">
        <div>
          <dt>Source</dt>
          <dd>{evidence.source}</dd>
        </div>
        <div>
          <dt>Clip window</dt>
          <dd>
            {timeLabel(evidence.clipStartS)}–{timeLabel(evidence.clipEndS)}
          </dd>
        </div>
        <div>
          <dt>Ride offset</dt>
          <dd>{timeLabel(evidence.rideOffsetS)}</dd>
        </div>
        <div>
          <dt>Recorded at</dt>
          <dd>{evidence.recordedAt ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Model assessment</dt>
          <dd>{evidence.assessment}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function EvidencePanel({
  snapshot,
  selectedHazard,
}: {
  snapshot: SnapshotView;
  selectedHazard: string | null;
}) {
  const hazard = snapshot.hazards.find((item) => item.id === selectedHazard) ?? snapshot.hazards[0];
  const evidence = snapshot.evidence.filter((item) => hazard?.evidenceIds.includes(item.id));
  // Every other revealed claim, newest first: the verification layer, including rejected claims.
  const otherClaims = snapshot.evidence
    .filter((item) => !hazard?.evidenceIds.includes(item.id))
    .reverse();
  return (
    <section className="ra-panel ra-evidence" aria-labelledby="ra-evidence-heading">
      <div className="ra-panel-title">
        <div>
          <span className="ra-eyebrow">WHY THIS REPORT EXISTS</span>
          <h2 id="ra-evidence-heading">Evidence & freshness</h2>
        </div>
        {hazard && (
          <span className={`ra-state ${lifecycleStyles[hazard.state].className}`}>
            <LifecycleIcon state={hazard.state} size={12} />
            {lifecycleStyles[hazard.state].description}
          </span>
        )}
      </div>
      {!hazard ? (
        <p className="ra-empty">
          No hazard report at this time. Play the preview or advance the replay.
        </p>
      ) : (
        <>
          <h3>{hazard.title}</h3>
          {hazard.synthetic && (
            <p className="ra-synthetic-banner">
              <FlaskConical size={14} aria-hidden="true" />
              Synthetic scenario report · not recorded footage
            </p>
          )}
          <p>
            Last supported at {timeLabel(hazard.lastSupportedS)} session time ·{' '}
            {Math.max(0, Math.floor(snapshot.timeS - hazard.lastSupportedS))}s ago
          </p>
          {hazard.state === 'stale' && (
            <p className="ra-notice">Stale does not mean clear. Fresh evidence is needed.</p>
          )}
          {hazard.state === 'disputed' && (
            <p className="ra-notice">Evidence conflicts. This report remains uncertain.</p>
          )}
          <dl className="ra-facts">
            <div>
              <dt>Location</dt>
              <dd>{hazard.locationMethod}</dd>
            </div>
            <div>
              <dt>Location uncertainty</dt>
              <dd>{hazard.uncertaintyM === null ? 'Unknown' : `±${hazard.uncertaintyM} m`}</dd>
            </div>
            <div>
              <dt>Evidence strength</dt>
              <dd>{hazard.strength}</dd>
            </div>
            <div>
              <dt>Impact</dt>
              <dd>{hazard.impact}</dd>
            </div>
          </dl>
          {evidence.map((item) => (
            <Clip key={item.id} evidence={item} />
          ))}
          {evidence.length === 0 && (
            <p className="ra-notice">
              Evidence references exist, but their details are unavailable.
            </p>
          )}
        </>
      )}
      {otherClaims.length > 0 && (
        <>
          <h3>Verification layer · other claims</h3>
          <p className="ra-subtle">
            Claims extracted from footage, with the server&apos;s review outcome. Rejected claims
            create no report.
          </p>
          {otherClaims.map((item) => (
            <Clip key={item.id} evidence={item} />
          ))}
        </>
      )}
    </section>
  );
}
