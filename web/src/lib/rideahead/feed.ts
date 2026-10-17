// Continuous ride camera feed: which recorded clip to show while the replay runs.
// Pure presentation; the server still decides which observation/evidence is current.
import { isPlayableRecorded } from './trust';
import { safeMediaPath, type EvidenceView } from './view';

export type FeedClip = { key: string; src: string; offsetS: number };
export type FeedSegment = {
  segment_id: string;
  ride_offset_s: number;
  media_ref?: string | null;
};

/** Reads "Session t=0 is ride offset 340 s" from scenario labels; 0 when absent. */
export function rideStartOffset(labels: readonly string[]): number {
  for (const label of labels) {
    const match = /ride offset (\d+(?:\.\d+)?)\s*s\b/i.exec(label);
    if (match) return Number(match[1]);
  }
  return 0;
}

/** The ride manifest's recorded segments, in ride order, with safe same-origin media paths. */
export function clipsFromSegments(segments: readonly FeedSegment[]): FeedClip[] {
  return segments
    .flatMap((segment) => {
      const src = safeMediaPath(segment.media_ref ?? null);
      return src ? [{ key: segment.segment_id, src, offsetS: segment.ride_offset_s }] : [];
    })
    .sort((a, b) => a.offsetS - b.offsetS);
}

/** Fallback for rides without a segment list: every recorded clip the replay has revealed. */
export function clipsFromEvidence(evidence: readonly EvidenceView[]): FeedClip[] {
  const seen = new Set<string>();
  const clips: FeedClip[] = [];
  for (const item of evidence) {
    if (!isPlayableRecorded(item) || !item.mediaPath || seen.has(item.mediaPath)) continue;
    seen.add(item.mediaPath);
    clips.push({ key: item.id, src: item.mediaPath, offsetS: item.rideOffsetS });
  }
  return clips.sort((a, b) => a.offsetS - b.offsetS);
}

/** Index of the last clip that starts at or before `offsetS` (the first clip before any). */
export function feedIndex(clips: readonly FeedClip[], offsetS: number): number {
  let index = 0;
  clips.forEach((clip, i) => {
    if (clip.offsetS <= offsetS) index = i;
  });
  return index;
}
