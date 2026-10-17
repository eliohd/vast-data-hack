// Optional demo key (server DEMO_KEY). Share the app as https://hack.elio.ltd/?key=… and the key
// is remembered for this browser, then sent on every API call and WebSocket.

const STORAGE_KEY = 'demo-key';
export const DEMO_KEY_HEADER = 'x-demo-key';

/** Reads `?key=` from a query string, falling back to a stored value. */
export function resolveDemoKey(search: string, stored: string | null): string | null {
  const fromUrl = new URLSearchParams(search).get('key');
  return fromUrl || stored || null;
}

export function demoKey(): string | null {
  if (typeof window === 'undefined') return null;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): fall back to the URL only.
  }
  const key = resolveDemoKey(window.location.search, stored);
  if (key && key !== stored) {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // ignore
    }
  }
  return key;
}

export function demoKeyHeaders(): Record<string, string> {
  const key = demoKey();
  return key ? { [DEMO_KEY_HEADER]: key } : {};
}

/** Appends `key=` to a WebSocket path when a demo key is set. */
export function withDemoKey(path: string, key: string | null = demoKey()): string {
  if (!key) return path;
  return `${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
}
