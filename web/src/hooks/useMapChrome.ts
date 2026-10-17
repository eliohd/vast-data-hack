import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Rect } from '@/lib/rideahead/projection';

export type MapChrome = { size: { width: number; height: number } | null; obstacles: Rect[] };

/**
 * Measures the map container and every `[data-map-chrome]` overlay inside the same
 * `.ra-navigation` section, in container-local CSS pixels, so the map can fit around them.
 */
export function useMapChrome(ref: RefObject<HTMLElement | null>): MapChrome {
  const [chrome, setChrome] = useState<MapChrome>({ size: null, obstacles: [] });
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const root = container.closest('.ra-navigation') ?? container.parentElement ?? container;
    let frame = 0;
    let observed: Element[] = [];
    const resize = new ResizeObserver(() => schedule());
    function measure() {
      frame = 0;
      if (!container) return;
      const box = container.getBoundingClientRect();
      // Cancel CSS `zoom` on the desktop phone frame: rects are zoomed, clientWidth is not.
      const scale = container.clientWidth ? box.width / container.clientWidth : 1;
      const elements = [...root.querySelectorAll('[data-map-chrome]')];
      if (elements.length !== observed.length || elements.some((el, i) => el !== observed[i])) {
        observed.forEach((el) => resize.unobserve(el));
        elements.forEach((el) => resize.observe(el));
        observed = elements;
      }
      const obstacles = elements
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: (rect.left - box.left) / scale,
          y: (rect.top - box.top) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        }));
      const next: MapChrome = {
        size: { width: container.clientWidth, height: container.clientHeight },
        obstacles,
      };
      setChrome((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    // Overlays appear, disappear and change size as snapshots arrive; ignore the map's own SVG.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !container.contains(record.target))) schedule();
    });
    resize.observe(container);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
  return chrome;
}
