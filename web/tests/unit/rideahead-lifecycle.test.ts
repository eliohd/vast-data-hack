import { describe, expect, it } from 'vitest';
import { lifecycleOrder, lifecycleStyles } from '@/lib/rideahead/lifecycle';
import { previewChapters, previewFrames } from '@/lib/rideahead/preview';
import type { HazardState } from '@/lib/rideahead/view';

// Every value of the generated Hazard.state enum (a new value fails type checks via `satisfies`).
const states: HazardState[] = ['observed', 'confirmed', 'stale', 'disputed', 'cleared'];

describe('lifecycle styles', () => {
  it('styles every state and shows each once in the legend', () => {
    expect(Object.keys(lifecycleStyles).sort()).toEqual([...states].sort());
    expect([...lifecycleOrder].sort()).toEqual([...states].sort());
  });
  it('gives each state a distinct colour and a distinct non-colour cue', () => {
    const fills = states.map((state) => lifecycleStyles[state].fill);
    expect(new Set(fills).size).toBe(states.length);
    const cues = states.map(
      (state) => `${lifecycleStyles[state].icon}|${lifecycleStyles[state].dash}`,
    );
    expect(new Set(cues).size).toBe(states.length);
    expect(new Set(states.map((state) => lifecycleStyles[state].icon)).size).toBe(states.length);
    for (const state of states) expect(lifecycleStyles[state].description).not.toBe('');
  });
  it('makes stale and cleared clearly different', () => {
    const { stale, cleared } = lifecycleStyles;
    expect(stale.fill).not.toBe(cleared.fill);
    expect(stale.dash).not.toBe(cleared.dash);
    expect(stale.icon).not.toBe(cleared.icon);
    expect(stale.opacity).toBeLessThan(cleared.opacity);
  });
});

describe('offline chapters', () => {
  it('has one server-labelled chapter per generated frame', () => {
    const chapters = previewChapters();
    expect(chapters.map((chapter) => chapter.timeS)).toEqual(
      previewFrames.map((frame) => frame.timeS),
    );
    for (const chapter of chapters) expect(chapter.label.length).toBeGreaterThan(0);
  });
});
