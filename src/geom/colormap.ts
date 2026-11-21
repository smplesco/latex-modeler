// Perceptual colormaps for surfaces and fields (sRGB, 0..1).
const MAPS: Record<string, string[]> = {
  viridis: ['#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
  ocean: ['#1d3f8f', '#2f6fd1', '#4a9fe0', '#7fc6ea', '#c3e6f2'],
  warm: ['#7a1f5c', '#b8325a', '#e0603f', '#f39b38', '#f7d65a'],
  cool: ['#2b3a8c', '#2f6fb8', '#2ba3b3', '#7ccf8a', '#e6f08a'],
  magma: ['#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'],
  gray: ['#3a3f47', '#d8dde3'],
};
const cache = new Map<string, number[][]>();
function stops(name: string) {
  const key = MAPS[name] ? name : 'viridis';
  if (!cache.has(key)) cache.set(key, MAPS[key].map(h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]));
  return cache.get(key)!;
}
export function cmap(t: number, name = 'viridis'): [number, number, number] {
  const s = stops(name);
  if (!isFinite(t)) t = 0;
  t = Math.min(1, Math.max(0, t)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(t)), f = t - i;
  return [s[i][0] + (s[i + 1][0] - s[i][0]) * f, s[i][1] + (s[i + 1][1] - s[i][1]) * f, s[i][2] + (s[i + 1][2] - s[i][2]) * f];
}
export const cmapHex = (t: number, name = 'viridis') => '#' + cmap(t, name).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
export const COLORMAPS = Object.keys(MAPS);
