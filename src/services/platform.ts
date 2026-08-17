export type OsKind = 'windows' | 'macos' | 'linux' | 'other';

export function detectOs(): OsKind {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

/** Custom min/max/close only on Windows. Mac/Linux use native window chrome. */
export function usesCustomWindowControls(): boolean {
  return detectOs() === 'windows';
}
