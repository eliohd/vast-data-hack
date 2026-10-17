import { describe, expect, it } from 'vitest';

import { resolveDemoKey, withDemoKey } from '@/lib/demoKey';
import { dataUrlBytes, fitWithin, pickRecorderMimeType } from '@/lib/frames';
import { parseServerMessage } from '@/lib/protocol';
import { backoffDelay, wsUrl } from '@/lib/socket';

describe('fitWithin', () => {
  it('scales the longest side down to the limit', () => {
    expect(fitWithin({ width: 1280, height: 720 }, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin({ width: 720, height: 1280 }, 640)).toEqual({ width: 360, height: 640 });
  });

  it('never scales up', () => {
    expect(fitWithin({ width: 320, height: 240 }, 640)).toEqual({ width: 320, height: 240 });
  });
});

describe('dataUrlBytes', () => {
  it('measures decoded size', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAEC')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAE=')).toBe(2);
  });
});

describe('pickRecorderMimeType', () => {
  it('prefers mp4 (iOS) over webm', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/mp4;codecs=avc1');
  });

  it('falls back to webm (Chrome/Android)', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
  });

  it('returns undefined when nothing is supported', () => {
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
  });
});

describe('parseServerMessage', () => {
  it('accepts known message types', () => {
    expect(parseServerMessage('{"type":"pong","sentAt":1}')).toEqual({ type: 'pong', sentAt: 1 });
  });

  it('rejects junk and unknown types', () => {
    expect(parseServerMessage('nope')).toBeNull();
    expect(parseServerMessage('{"type":"other"}')).toBeNull();
    expect(parseServerMessage('42')).toBeNull();
  });
});

describe('socket helpers', () => {
  it('backs off exponentially with a cap', () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffDelay(n))).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('matches the page scheme', () => {
    expect(wsUrl('/ws/live', { protocol: 'https:', host: 'hack.elio.ltd' })).toBe(
      'wss://hack.elio.ltd/ws/live',
    );
    expect(wsUrl('/ws/live', { protocol: 'http:', host: 'localhost:4321' })).toBe(
      'ws://localhost:4321/ws/live',
    );
  });
});

describe('demo key', () => {
  it('prefers the URL over storage', () => {
    expect(resolveDemoKey('?key=abc', 'old')).toBe('abc');
    expect(resolveDemoKey('', 'old')).toBe('old');
    expect(resolveDemoKey('', null)).toBeNull();
  });

  it('appends the key to socket paths', () => {
    expect(withDemoKey('/ws/live', 'a b')).toBe('/ws/live?key=a%20b');
    expect(withDemoKey('/ws/live?x=1', 'k')).toBe('/ws/live?x=1&key=k');
    expect(withDemoKey('/ws/live', null)).toBe('/ws/live');
  });
});
