// Ink travels with a page as one last comment line: "//@ink [...]". Any version of the language reads that
// line as a comment, so a file with ink still runs everywhere; the editor never shows the line.
import type { Stroke } from './render/ink';

export const INK_TAG = '//@ink ';
const MAX_STROKES = 5000, MAX_POINTS = 2_000_000;

/** the page code with its ink appended (unchanged when there is no ink) */
export function joinInk(code: string, ink?: Stroke[] | null): string {
  if (!ink || !ink.length) return code;
  const pts = ink.map(s => ({ tool: s.tool, color: s.color, w: s.w, pts: s.pts.map(v => (Number.isFinite(v) ? +v.toFixed(2) : null)), ...(s.slide ? { slide: s.slide } : {}) }));
  return code + (code === '' || code.endsWith('\n') ? '' : '\n') + INK_TAG + JSON.stringify(pts) + '\n';
}

/** split a file's text into the code the editor shows and the ink (if the file has a valid ink line) */
export function splitInk(text: string): { code: string; ink?: Stroke[] } {
  const at = text.startsWith(INK_TAG) ? 0 : text.lastIndexOf('\n' + INK_TAG) + 1;
  if (at <= 0 && !text.startsWith(INK_TAG)) return { code: text };
  const end = text.indexOf('\n', at), line = text.slice(at + INK_TAG.length, end < 0 ? undefined : end);
  if (end >= 0 && text.slice(end).trim() !== '') return { code: text };   // only a trailing ink line counts
  let ink: Stroke[] | undefined;
  try {
    const a = JSON.parse(line);
    if (!Array.isArray(a) || a.length > MAX_STROKES) return { code: text };
    let n = 0;
    ink = a.filter((s: any) => s && (s.tool === 'pen' || s.tool === 'hl') && typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color)
      && typeof s.w === 'number' && s.w > 0 && s.w < 50 && Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length % 3 === 0
      && (n += s.pts.length) <= MAX_POINTS && s.pts.every((v: any) => v === null || (typeof v === 'number' && Math.abs(v) < 1e5)))
      .map((s: any) => ({ tool: s.tool, color: s.color, w: s.w, pts: s.pts.map((v: any) => (v === null ? NaN : v)), ...(Number.isInteger(s.slide) && s.slide > 0 && s.slide < 1000 ? { slide: s.slide } : {}) }));
  } catch { return { code: text }; }
  return { code: text.slice(0, at), ink: ink && ink.length ? ink : undefined };
}

/** SVG polylines for the ink, in page millimetres (page height h flips y) */
export function inkSVG(ink: Stroke[] | undefined, h: number, slide = 0): string {
  ink = ink?.filter(s => (s.slide ?? 0) === slide);
  if (!ink?.length) return '';
  const f = (v: number) => +v.toFixed(2);
  return ink.map(s => {
    const p: string[] = []; for (let i = 0; i < s.pts.length; i += 3) p.push(`${f(s.pts[i])},${f(h - s.pts[i + 1])}`);
    if (p.length === 1) p.push(p[0]);
    return `<polyline points="${p.join(' ')}" fill="none" stroke="${s.color.replace(/[^#0-9a-f]/gi, '')}" stroke-width="${f(s.w)}" stroke-linecap="round" stroke-linejoin="round"${s.tool === 'hl' ? ' stroke-opacity="0.38"' : ''}/>`;
  }).join('\n');
}
