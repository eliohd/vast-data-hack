// Single-rider live mode: turns /ws/ride results into what Clover shows and says.
// Pure, unit-tested. The server shape comes from server/app/agent/ride_live.py.

export type RideAdvice = 'continue' | 'heads_up' | 'slow' | 'reroute';

export interface RideWarning {
  hazard: string;
  advice: RideAdvice;
  message: string;
  confidence: number;
  /** Client time the frame was captured. */
  at: number;
}

const ADVICE = new Set<RideAdvice>(['continue', 'heads_up', 'slow', 'reroute']);
/** Keep a warning on screen this long after the last frame that saw it, so it doesn't flicker. */
export const HOLD_MS = 6000;
/** Don't repeat the same spoken warning more often than this. */
export const REPEAT_MS = 12000;

export const adviceLabels: Record<RideAdvice, string> = {
  continue: 'All clear',
  heads_up: 'Heads up',
  slow: 'Slow down',
  reroute: 'Reroute',
};

export function warningFrom(data: Record<string, unknown>, at: number): RideWarning | null {
  const advice = data.advice;
  if (typeof advice !== 'string' || !ADVICE.has(advice as RideAdvice)) return null;
  return {
    hazard: typeof data.hazard === 'string' ? data.hazard : 'none',
    advice: advice as RideAdvice,
    message: typeof data.message === 'string' ? data.message : '',
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
    at,
  };
}

/** The warning to show now: the latest real warning while it is held, else the latest result. */
export function displayed(
  active: RideWarning | null,
  latest: RideWarning | null,
  now: number,
): RideWarning | null {
  if (active && active.advice !== 'continue' && now - active.at < HOLD_MS) return active;
  return latest;
}

/** Speak when a real warning is new, changes hazard/advice, or repeats after REPEAT_MS. */
export function shouldAnnounce(prev: RideWarning | null, next: RideWarning): boolean {
  if (next.advice === 'continue') return false;
  if (!prev || prev.advice === 'continue') return true;
  if (prev.hazard !== next.hazard || prev.advice !== next.advice) return true;
  return next.at - prev.at >= REPEAT_MS;
}
