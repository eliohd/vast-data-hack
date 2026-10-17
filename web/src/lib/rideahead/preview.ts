import type { Schemas } from '@/lib/api/client';
import { toSnapshotView } from './connection';
import canonical from './canonical-snapshots.json';
import type { SnapshotView } from './view';

// Copy of Agent A's generated canonical fixture at bootstrap 5b43e3f.
// Regenerate with make gen-api, then copy server/fixtures/rideahead/snapshots.json here.
export const previewFrames = Object.entries(canonical)
  .filter(([key]) => key.startsWith('t'))
  .map(([, value]) => toSnapshotView(value as unknown as Schemas['SessionSnapshot']))
  .sort((a, b) => a.timeS - b.timeS);

export function previewAt(timeS: number): SnapshotView {
  // Select complete authored snapshots; never derive lifecycle or route decisions.
  // The displayed clock stays at the snapshot time because there is no offline engine.
  return [...previewFrames].reverse().find((frame) => frame.timeS <= timeS) ?? previewFrames[0];
}
