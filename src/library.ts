// The built-in library: page templates and example pages, read from src/templates and src/examples/<folder>.
// Each file starts with "// Title — what it shows"; the page() line gives its format.
import { PAGES, PAGE_STYLES, STAGES } from './lang/pages';

export interface LibItem {
  /** stable key: "templates/notes.bd", "examples/physics/projectile.bd" */
  key: string; kind: 'template' | 'example';
  folder: string; file: string; title: string; about: string; src: string;
  /** e.g. "A4 · Lined · Desk" */
  format: string;
}

export const FOLDERS: [string, string][] = [
  ['getting-started', 'Getting started'], ['surfaces', 'Surfaces'], ['curves-and-fields', 'Curves & fields'],
  ['physics', 'Physics'], ['calculus', 'Calculus'], ['linear-algebra', 'Linear algebra'], ['interactive', 'Sliders & decks'],
];
const TEMPLATE_ORDER = ['blank', 'notes', 'chalkboard', 'slides', 'deck', 'blueprint', 'poster', 'worksheet', 'figure'];

/** "A4 · Lined · Desk" from a page("A4", "lined", {stage: "desk"}) line */
export function formatOf(src: string): string {
  const m = /^\s*page\s*\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)")?\s*(?:,\s*\{[^}]*stage\s*:\s*"([^"]*)"[^}]*\})?/m.exec(src);
  if (!m) return 'A4 · Plain · Studio';
  const size = m[1].replace(/^slide$/i, 'Slide 16:9').replace(/^square$/i, 'Square').replace(/^letter/i, 'Letter').replace(/\s*landscape$/i, ' landscape');
  return [size, PAGE_STYLES[m[2] || 'paper']?.label ?? m[2], STAGES[m[3] || 'studio']?.label ?? m[3]].join(' · ');
}

function parse(key: string, src: string, kind: LibItem['kind']): LibItem {
  const parts = key.split('/'); const file = parts[parts.length - 1];
  const folder = kind === 'example' ? parts[parts.length - 2] : 'templates';
  const head = /^\/\/\s*(.+?)\s+—\s+(.+)$/.exec(src.split('\n')[0] || '');
  const title = head ? head[1] : file.replace(/\.bd$/, '').replace(/-/g, ' ');
  return { key, kind, folder, file, title, about: head ? head[2] : '', src, format: formatOf(src) };
}

const raw = (g: Record<string, unknown>) => Object.entries(g as Record<string, string>).map(([k, v]) => [k.replace(/^\.\//, ''), v] as const);
export const TEMPLATES: LibItem[] = raw(import.meta.glob('./templates/*.bd', { query: '?raw', import: 'default', eager: true }))
  .map(([k, v]) => parse(k, v, 'template'))
  .sort((a, b) => TEMPLATE_ORDER.indexOf(a.file.replace(/\.bd$/, '')) - TEMPLATE_ORDER.indexOf(b.file.replace(/\.bd$/, '')));
export const EXAMPLES: LibItem[] = raw(import.meta.glob('./examples/**/*.bd', { query: '?raw', import: 'default', eager: true }))
  .map(([k, v]) => parse(k, v, 'example'))
  .sort((a, b) => FOLDERS.findIndex(f => f[0] === a.folder) - FOLDERS.findIndex(f => f[0] === b.folder) || (a.file === 'first-page.bd' ? -1 : b.file === 'first-page.bd' ? 1 : a.title.localeCompare(b.title)));
export const byKey = (key: string | undefined) => (key ? EXAMPLES.find(e => e.key === key) ?? TEMPLATES.find(e => e.key === key) : undefined);

// ---- a blank page in any format
export const SIZE_CHOICES: [string, string][] = [['A4', 'A4'], ['A4 landscape', 'A4 landscape'], ['A5', 'A5'], ['A5 landscape', 'A5 landscape'], ['A3', 'A3'], ['letter', 'Letter'], ['slide', 'Slide 16:9'], ['square', 'Square']];
export function blankPage(size: string, style: string, stage: string): string {
  const [w0, h0] = PAGES[size.replace(/\s*landscape$/i, '')] ?? PAGES.A4;
  const [w, h] = /landscape$/i.test(size) ? [h0, w0] : [w0, h0];
  const r = (v: number) => +v.toFixed(1);
  const cx = r(w / 2), top = h - Math.max(14, h * 0.085), title = Math.max(14, Math.min(24, w / 9.5));
  return `// Untitled — a blank ${formatOf(`page("${size}", "${style}", {stage: "${stage}"})`)} page.
page("${size}", "${style}"${stage !== 'studio' ? `, {stage: "${stage}"}` : ''})

tex("\\textbf{Untitled}", (${cx}, ${r(top)}), {size: ${r(title)}})
line((${r(w * 0.1)}, ${r(top - title * 0.55)}), (${r(w * 0.9)}, ${r(top - title * 0.55)}), {width: 0.3})
`;
}
