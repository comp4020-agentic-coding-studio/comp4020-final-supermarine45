// `Number(x) || fallback` treats 0 as missing, so `?limit=0` (a real,
// meaningful request for "give me nothing") would silently become `?limit=20`.
// Only an actually-absent or non-numeric value should fall back.
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(0, base), max);
}
