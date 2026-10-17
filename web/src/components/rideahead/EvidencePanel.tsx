import { useState } from 'react';
import { withDemoKey } from '@/lib/demoKey';
import { safeMediaPath, stateLabels, timeLabel, type SnapshotView } from '@/lib/rideahead/view';

function Clip({ evidence }: { evidence: SnapshotView['evidence'][number] }) {
  const [failed, setFailed] = useState(false);
  const media = safeMediaPath(evidence.mediaPath);
  return (
    <article className="ra-evidence-item">
      <div className="ra-panel-title">
        <strong>Evidence · {evidence.id}</strong>
        <span className="ra-tag">{evidence.provenance}</span>
      </div>
      {media && !failed ? (
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
        <div className="ra-video-empty">
          <span aria-hidden="true">▷</span>
          <strong>{failed ? 'Clip playback failed' : 'No playable recorded clip'}</strong>
          <p>
            {failed
              ? 'The clip may have expired or require access. Retry after refreshing the session.'
              : 'A source clip will appear here when recorded evidence is connected.'}
          </p>
        </div>
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
  return (
    <section className="ra-panel ra-evidence" aria-labelledby="ra-evidence-heading">
      <div className="ra-panel-title">
        <div>
          <span className="ra-eyebrow">WHY THIS REPORT EXISTS</span>
          <h2 id="ra-evidence-heading">Evidence & freshness</h2>
        </div>
        {hazard && (
          <span className={`ra-state ra-${hazard.state}`}>{stateLabels[hazard.state]}</span>
        )}
      </div>
      {!hazard ? (
        <p className="ra-empty">
          No hazard report at this time. Play the preview or advance the replay.
        </p>
      ) : (
        <>
          <h3>{hazard.title}</h3>
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
    </section>
  );
}
