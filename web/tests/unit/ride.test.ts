import { describe, expect, it } from 'vitest';
import { HOLD_MS, REPEAT_MS, displayed, shouldAnnounce, warningFrom } from '@/lib/ride';

const w = (advice: string, hazard: string, at: number) =>
  warningFrom({ advice, hazard, message: 'm', confidence: 0.9 }, at)!;

describe('single-rider live warnings', () => {
  it('rejects results that are not ride warnings', () => {
    expect(warningFrom({ summary: 'x' }, 0)).toBeNull();
    expect(w('slow', 'lane_blocked', 5)).toMatchObject({ advice: 'slow', at: 5 });
  });

  it('announces new warnings, not repeats or all-clears', () => {
    const first = w('slow', 'lane_blocked', 0);
    expect(shouldAnnounce(null, first)).toBe(true);
    expect(shouldAnnounce(first, w('slow', 'lane_blocked', 1000))).toBe(false);
    expect(shouldAnnounce(first, w('reroute', 'lane_blocked', 1000))).toBe(true);
    expect(shouldAnnounce(first, w('slow', 'lane_blocked', REPEAT_MS))).toBe(true);
    expect(shouldAnnounce(first, w('continue', 'none', 1000))).toBe(false);
  });

  it('holds a warning on screen briefly after an all-clear frame', () => {
    const warn = w('slow', 'pedestrian', 0);
    const clear = w('continue', 'none', 1000);
    expect(displayed(warn, clear, 1000)).toBe(warn);
    expect(displayed(warn, clear, HOLD_MS + 1)).toBe(clear);
  });
});
