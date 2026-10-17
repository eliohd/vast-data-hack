import { useEffect } from 'react';

/** Keeps the phone screen awake while `active` (Screen Wake Lock API, iOS 16.4+). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) await sentinel.release();
      } catch {
        // Denied or unsupported (e.g. low battery mode). Not fatal.
      }
    };
    // The lock is dropped whenever the page is hidden, so take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [active]);
}
