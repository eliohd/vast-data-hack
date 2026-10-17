import { describe, expect, it } from 'vitest';
import { previewAt } from '@/lib/rideahead/preview';
import { mapProjection, safeMediaPath, timeLabel } from '@/lib/rideahead/view';

describe('replay presentation', () => {
  it('never exposes a future observation or clearance', () => {
    expect(previewAt(59).evidence).toEqual([]);
    expect(previewAt(329).hazards[0].state).toBe('observed');
    expect(previewAt(449).hazards[0].state).toBe('stale');
    expect(previewAt(449).evidence.some((item) => item.id === 'ev-syn-clear-001')).toBe(false);
    expect(previewAt(450).hazards[0].state).toBe('cleared');
    expect(previewAt(450).evidence[2].provenance).toContain('Synthetic');
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
describe('route overview projection', () => {
  it('keeps north up, east right and fits a small geographic area', () => {
    const southWest = { lat: 51.5, lon: -0.12 };
    const northEast = { lat: 51.51, lon: -0.11 };
    const project = mapProjection([southWest, northEast])!;
    const a = project(southWest),
      b = project(northEast);
    expect(a[0]).toBeLessThan(b[0]);
    expect(a[1]).toBeGreaterThan(b[1]);
    for (const [x, y] of [a, b]) {
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(680);
      expect(y).toBeGreaterThanOrEqual(30 - 1e-6);
      expect(y).toBeLessThanOrEqual(390 + 1e-6);
    }
  });
  it('leaves unknown geography unmapped and handles a single point', () => {
    expect(mapProjection([])).toBeNull();
    expect(mapProjection([{ lat: 100, lon: 0 }])).toBeNull();
    expect(mapProjection([{ lat: 0, lon: 0 }])!({ lat: 0, lon: 0 })).toEqual([350, 210]);
  });
});
