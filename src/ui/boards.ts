// Board mode (Screenboard) lives at ./board/ on the same site, so its library is readable from here:
// the start screen lists recent boards from it. Read-only: this never creates or changes the library.

export interface BoardEntry { id: string; name: string; updated: number; pages: number; thumb: string | null }

export const BOARD_URL = './board/';
export const BOARD_THEMES: { key: string; label: string; about: string; bg: string; ink: string; accent: string }[] = [
  { key: 'chalkboard', label: 'Chalkboard', about: 'Green board, chalk colours', bg: '#12352c', ink: '#f3f6f1', accent: '#ffd98e' },
  { key: 'whiteboard', label: 'Whiteboard', about: 'White board, marker colours', bg: '#fcfcfa', ink: '#1f2a44', accent: '#e5484d' },
  { key: 'slate', label: 'Slate', about: 'Dark grey board', bg: '#23262b', ink: '#eef1f5', accent: '#9ecffb' },
];

const DOC_ID = /^[a-z0-9]{6,40}$/;
const SAFE_IMG = /^data:image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml);base64,/i;   // pictures only, shown with <img> (which never runs scripts)

/** the most recently changed boards in this browser's board library (empty if there are none) */
export function recentBoards(limit = 8): Promise<BoardEntry[]> {
  return new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open('screenboard'); } catch { resolve([]); return; }
    let done = false; const finish = (v: BoardEntry[]) => { if (!done) { done = true; resolve(v); } };
    req.onupgradeneeded = () => { try { req.transaction?.abort(); } catch { /* ignore */ } };   // no library yet: don't create one
    req.onerror = () => finish([]);
    req.onblocked = () => finish([]);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('kv')) { db.close(); finish([]); return; }
        const q = db.transaction('kv').objectStore('kv').get('lib');
        q.onsuccess = () => { db.close(); finish(parse(q.result, limit)); };
        q.onerror = () => { db.close(); finish([]); };
      } catch { try { db.close(); } catch { /* ignore */ } finish([]); }
    };
    setTimeout(() => finish([]), 3000);
  });
}

function parse(list: unknown, limit: number): BoardEntry[] {
  if (!Array.isArray(list)) return [];
  const out: BoardEntry[] = [];
  for (const e of list as any[]) {
    if (!e || typeof e !== 'object' || e.trashed || e.template || !DOC_ID.test(String(e.id ?? ''))) continue;
    const thumb = Array.isArray(e.thumbs) && typeof e.thumbs[0] === 'string' && SAFE_IMG.test(e.thumbs[0].slice(0, 40)) ? e.thumbs[0] : null;
    out.push({ id: e.id, name: String(e.name || 'Untitled board').slice(0, 80), updated: Number(e.updated) || 0, pages: Math.max(1, Number(e.pages) || 1), thumb });
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, limit);
}

/** "5 min ago", "yesterday", "Mar 3" */
export function ago(t: number): string {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** a small drawing of an empty board in a theme, for the "new board" cards */
export function boardSketch(t: (typeof BOARD_THEMES)[number]): string {
  return `<svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block;background:${t.bg}">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 96V22M22 96h118" stroke="${t.ink}" stroke-opacity=".55" stroke-width="1.6"/>
      <path d="M30 88c14-2 24-50 44-52s30 40 52 42" stroke="${t.accent}" stroke-width="2.6"/>
      <path d="M96 30l18-8m0 0-7-1m7 1-4 6" stroke="${t.ink}" stroke-width="1.6"/>
      <circle cx="74" cy="36" r="6" stroke="${t.ink}" stroke-width="1.5"/>
    </g></svg>`;
}
