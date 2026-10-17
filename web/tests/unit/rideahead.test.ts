import { describe, expect, it } from 'vitest';
import { previewAt } from '@/lib/rideahead/preview';
import { safeMediaPath, timeLabel } from '@/lib/rideahead/view';

describe('replay presentation', () => {
  it('never exposes a future observation or clearance', () => {
    expect(previewAt(59).evidence).toEqual([]);
    expect(previewAt(329).hazards[0].state).toBe('observed');
    expect(previewAt(449).hazards[0].state).toBe('stale');
    expect(previewAt(449).evidence.some((item) => item.id.includes('syn-clear'))).toBe(false);
    expect(previewAt(480).hazards[0].state).toBe('cleared');
    expect(previewAt(480).evidence.at(-1)?.provenance).toContain('Synthetic');
  });
  it('rewinds deterministically without retaining future reports', () => {
    previewAt(180);
    expect(previewAt(0).hazards).toEqual([]);
    expect(previewAt(30)).toEqual(previewAt(30));
  });
  it('formats session time without implying wall-clock recording time', () => {
    expect(timeLabel(125.9)).toBe('2:05');
    expect(timeLabel(-1)).toBe('0:00');
  });
});
describe('application media boundary', () => {
  it('allows the existing same-origin source proxy', () => {
    expect(safeMediaPath('/api/archive/media?source=ride%2Fclip.mp4')).toBe(
      '/api/archive/media?source=ride%2Fclip.mp4',
    );
  });
  it('rejects external links, authenticated URLs and unsupported paths', () => {
    for (const path of [
      null,
      'https://upstream.example/video?token=secret',
      '//upstream.example/video',
      '/api/archive/media?source=clip&token=secret',
      '/api/archive/media?source=clip&key=secret',
      '/api/archive/media?source=clip#t=0',
      '/other.mp4',
    ])
      expect(safeMediaPath(path)).toBeNull();
  });
});
