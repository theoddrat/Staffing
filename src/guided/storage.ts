// Per-browser conveniences only (mode, tour seen). Storage can be missing or throw (private
// windows, blocked site data, artifact previews), so every access is guarded and the app works
// without it.
const PREFIX = 'acm.';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: keep the in-memory value only */
  }
}
