/** Display preferences must never prevent public browsing in privacy modes. */
export function readPreference(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
  catch { return null; }
}
export function savePreference(key: string, value: string): boolean {
  try { if (typeof window === 'undefined') return false; window.localStorage.setItem(key, value); return true; }
  catch { return false; }
}
