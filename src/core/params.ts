// URL parameters. Tools and photo spots drive the game through these,
// e.g. index.html?seed=7&spot=downtown&time=17.5&quality=high&capture=1

const search = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export function paramStr(name: string, fallback: string): string {
  return search.get(name) ?? fallback;
}

export function paramNum(name: string, fallback: number): number {
  const v = search.get(name);
  if (v === null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function paramBool(name: string, fallback = false): boolean {
  const v = search.get(name);
  if (v === null) return fallback;
  return v === '' || v === '1' || v === 'true' || v === 'yes';
}

export function paramNums(name: string): number[] | null {
  const v = search.get(name);
  if (!v) return null;
  const parts = v.split(',').map(Number);
  return parts.every(Number.isFinite) ? parts : null;
}

/** True when a tool (Playwright) is capturing a screenshot: no pointer lock, no UI hints. */
export const isCapture = paramBool('capture');
