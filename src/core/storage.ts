// localStorage can be missing or throw (private windows, blocked storage, sandboxed pages).
// Everything stored here is a per-viewer convenience, so failures are ignored.

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem('solmar.' + key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem('solmar.' + key, value);
  } catch {
    /* storage unavailable */
  }
}
