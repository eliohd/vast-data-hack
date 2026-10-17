import { describe, expect, it } from 'vitest';
import { clipsFromSegments, feedIndex, rideStartOffset } from '@/lib/rideahead/feed';

const seg = (offset: number) => ({
  segment_id: `s${offset}`,
  ride_offset_s: offset,
  media_ref: `/api/archive/media?source=s3%3A%2F%2Fb%2F${offset}.mp4`,
});

describe('continuous ride feed', () => {
  it('reads the session-to-ride offset from scenario labels', () => {
    expect(rideStartOffset(['Bike B is simulated', 'Session t=0 is ride offset 340 s of X'])).toBe(
      340,
    );
    expect(rideStartOffset(['no offset here'])).toBe(0);
  });

  it('orders segments and drops unsafe media paths', () => {
    const clips = clipsFromSegments([seg(395), seg(90), { ...seg(1), media_ref: 'https://x' }]);
    expect(clips.map((c) => c.offsetS)).toEqual([90, 395]);
  });

  it('follows the replay clock to the clip covering that ride offset', () => {
    const clips = clipsFromSegments([seg(90), seg(380), seg(395), seg(425)]);
    expect(feedIndex(clips, 340)).toBe(0);
    expect(feedIndex(clips, 381)).toBe(1);
    expect(feedIndex(clips, 1000)).toBe(3);
    expect(feedIndex(clips, 10)).toBe(0);
  });
});
