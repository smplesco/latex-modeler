// LaTeX Modeler — application shell.
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { runProgram, RunCtx } from './lang/interp';
import { Viewer } from './render/viewer';
import { texReady, measureTex, previewSVG, getTex, recordTex, stopRecordingTex } from './render/tex';
import { exportSVG } from './render/export';
import { Editor } from './editor/editor';
import { MODEL_EXAMPLES } from './model/examples';
import { EXAMPLES as LIBRARY, byKey, type LibItem } from './library';
import { PAGES, PAGE_STYLES, STAGES } from './lang/pages';
import { Home } from './ui/home';
import { Thumbs } from './ui/thumbs';
import { Ink, type Stroke } from './render/ink';
import { ControlPanel } from './ui/controls';
import { Presenter } from './ui/present';
import { openWritePad } from './ui/writepad';
import { LiveHost, LiveViewer, parseWatch, type LiveState } from './live';
import { registerOffline } from './offline';
registerOffline();
import type { ModelResult } from './model/generate';
import { getPlatform, Platform } from './platform';
import { REFERENCE } from './ui/reference';
import { shareLink, readShare } from './share';
import { joinInk, splitInk, inkSVG } from './inkfile';
import { record, supportedFormats, type RecFormat } from './render/record';
import type { Explorer } from './explore/explorer';
import { FigureChips, type ExploreTarget } from './explore/chips';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ documents
// example docs remember which library page they came from (src), so they can be reverted and stay clean until edited
interface Doc { id: string; name: string; text: string; saved: string; path?: string; example?: boolean; src?: string; ink?: Stroke[]; inkSaved?: string; /** a page someone is presenting live to us (not kept between visits) */ live?: boolean; /** slider and toggle values the reader set */ vals?: Record<string, number>; /** the slide being shown */ slide?: number }
const STORE = 'lm.session.v3', OLD_STORE = 'bdraw.session.v2';
let docs: Doc[] = [], current = '';          // current = '' → the start screen (or a board tab, when boardCur is set)
/** boards open as tabs next to pages: each runs board mode in its own frame, which keeps its state while you switch */
interface BoardTab { key: string; url: string; id?: string; name: string; frame?: HTMLIFrameElement }
const boardTabs: BoardTab[] = []; let boardCur = '';
const original = (d: Doc) => (d.example ? byKey(d.src)?.src : undefined);
function loadSession() {
  let saved: Doc[] = [], migrating = false;
  try {
    let raw = localStorage.getItem(STORE);
    if (raw === null) { raw = localStorage.getItem(OLD_STORE); migrating = raw !== null; }
    const s = JSON.parse(raw || 'null'); if (s && Array.isArray(s.docs)) saved = s.docs;
    // board tabs come back too (they load only when you click them)
    if (s && Array.isArray(s.boards)) for (const b of s.boards.slice(0, 20)) if (b && /^[a-z0-9]{6,40}$/.test(String(b.id)) && typeof b.name === 'string') boardTabs.push({ key: 'b' + b.id, url: './board/?open=' + b.id + '&embed=1', id: b.id, name: b.name.slice(0, 80) });
  } catch { /* ignore */ }
  for (const d of saved) {
    if (!d || typeof d.text !== 'string' || typeof d.name !== 'string') continue;
    if (typeof d.inkSaved !== 'string') delete d.inkSaved;
    if (d.example) {
      // older versions kept every example open by name; now examples open only when asked, from their folder
      d.src ??= LIBRARY.find(e => e.file === d.name)?.key;
      const orig = original(d);
      if (orig === undefined) { d.example = false; d.saved = ''; }      // the example is gone: keep the edits as an unsaved page
      else if (migrating && d.text === orig) continue;                  // examples the old version opened by itself
    }
    docs.push(d);
  }
  if (migrating) { try { localStorage.removeItem(OLD_STORE); } catch { /* ignore */ } persist(); }
}
let saveTimer = 0;
function persist() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify({ docs: docs.filter(d => !d.live), current: doc()?.live ? '' : current, boards: boardTabs.filter(b => b.id).map(b => ({ id: b.id, name: b.name })) })); } catch { /* ignore */ } }, 300); }
const doc = (): Doc | undefined => docs.find(d => d.id === current);
const inkKey = (d: Doc) => (d.ink?.length ? JSON.stringify(d.ink) : '');
const isDirty = (d: Doc) => (d.example ? d.text !== original(d) || !!d.ink?.length : d.text !== d.saved || inkKey(d) !== (d.inkSaved ?? ''));
/** a doc from a file's text: the ink line (if any) comes off the code and becomes the page's ink */
function fileDoc(name: string, text: string, path?: string) {
  const { code, ink } = splitInk(text);
  return { name, text: code, path, extra: ink ? { ink, inkSaved: JSON.stringify(ink) } : {} };
}
const slug = (name: string) => name.replace(/\.bd$/, '').replace(/[^A-Za-z0-9-]/g, '-');

// ------------------------------------------------------------------ UI objects
let platform: Platform;
const editor = new Editor($('editor'));
const viewer = new Viewer($('gl'));
const ink = new Ink(viewer);
const controls = new ControlPanel($('gl'));
// ---- Figure Explorer: open any figure as a live 3D / 2D graph
// the Figure Explorer is loaded the first time someone opens a figure (keeps start-up light)
let explorer: Explorer | null = null, explorerLoad: Promise<Explorer> | null = null;
const getExplorer = () => (explorerLoad ??= import('./explore/explorer').then(m => (explorer = new m.Explorer($('viewpane'), {
  source: () => editor.value,
  time: () => tCur,
  measure: measureTex,
  title: () => doc()?.name ?? 'page.bd',
  hooks: () => ({ sliders: doc()?.vals, slide: doc()?.slide ?? 0 }),
  writeBack: (name, value, line) => {
    const lines = editor.value.split('\n'); const L = lines[line - 1] ?? '';
    const m = new RegExp('^(\\s*' + name + '\\s*=\\s*)(-?[0-9.eE+]+)').exec(L);
    if (!m) { toast(`couldn't find "${name} = …" on line ${line}`); return; }
    lines[line - 1] = m[1] + String(+value.toPrecision(6)) + L.slice(m[0].length);
    const pos = editor.ta.selectionStart; editor.value = lines.join('\n'); editor.ta.setSelectionRange(pos, pos);
    const d = doc(); if (d) d.text = editor.value; persist(); updateTabs(); compile(false);
    toast(`${name} = ${+value.toPrecision(6)} written to line ${line}`);
  },
  snapshot: (url, name) => exportImage(url, name),
  save: (name, data, mime) => { platform.exportFile(name, data, mime).then(ok => { if (ok && platform.kind === 'desktop') toast('saved ' + name); }).catch((e: any) => toast('export failed: ' + (e?.message || e))); },
}))));
const openExplore = (t: ExploreTarget) => getExplorer().then(x => x.openTarget(t)).catch(e => toast('could not open the explorer: ' + (e?.message || e)));
const chips = new FigureChips($('gl'), viewer, openExplore);

function updateTabs() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  const home = document.createElement('div');
  home.className = 'tab home' + (current || boardCur ? '' : ' act'); home.title = 'Start screen: templates and examples';
  home.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2 7.5 8 2.5l6 5M3.8 6.2V13.5h3V10h2.4v3.5h3V6.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span>Home</span>';
  home.onclick = () => showHome();
  tabs.appendChild(home);
  for (const d of docs) {
    const el = document.createElement('div');
    el.className = 'tab' + (d.id === current ? ' act' : '') + (isDirty(d) ? ' modified' : '');
    el.title = d.example ? `example · ${d.src?.replace(/^examples\//, '')}` : d.path ?? 'not saved to a file yet';
    el.innerHTML = `<span class="ic">bd</span><span>${esc(d.name)}</span><span class="x" title="Close"><span>×</span></span>`;
    el.onclick = (e) => { if ((e.target as HTMLElement).closest('.x')) { closeDoc(d); return; } openDoc(d.id); };
    el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeDoc(d); } };   // middle-click closes, like a browser
    tabs.appendChild(el);
  }
  for (const b of boardTabs) {
    const el = document.createElement('div');
    el.className = 'tab board' + (b.key === boardCur ? ' act' : '');
    el.title = 'Board';
    el.innerHTML = `<span class="ic">▦</span><span>${esc(b.name)}</span><span class="x" title="Close"><span>×</span></span>`;
    el.onclick = (e) => { if ((e.target as HTMLElement).closest('.x')) { closeBoard(b); return; } showBoard(b.key); };
    el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeBoard(b); } };
    tabs.appendChild(el);
  }
  tabs.querySelector('.act')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const d = doc();
  if (boardCur) { const b = boardTabs.find(x => x.key === boardCur); platform?.setTitle(`${b?.name ?? 'Board'} — LaTeX Modeler`); $('app').classList.add('at-home'); return; }
  $('app').classList.toggle('at-home', !d);
  if (!d) { platform?.setTitle('LaTeX Modeler'); return; }
  const folder = d.example && d.src ? d.src.split('/').slice(1, -1).join(' › ') : '';
  $('crumbDir').textContent = d.example ? 'examples' + (folder ? ' › ' + folder : '') : d.path ? 'file' : 'unsaved';
  $('crumbName').textContent = d.name;
  $('crumbPath').textContent = d.path ?? '';
  $('bRevert').style.display = d.example ? '' : 'none';
  platform?.setTitle(`${d.name}${isDirty(d) ? ' •' : ''} — LaTeX Modeler`);
}
function setHash(h: string) { try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch { /* ignore */ } }
function openDoc(id: string) {
  const d = docs.find(x => x.id === id); if (!d) { showHome(); return; }
  const leaving = !current; current = id;
  home?.el.classList.remove('show'); leaveBoard();
  updateTabs(); persist();
  editor.value = d.text;
  ink.set(d.ink);
  setHash(slug(d.name));
  if (leaving) { viewer.resize(); editor.refresh(); }
  tCur = 0; firstFit = true; compile(true);
  live?.doc(); live?.state();
}
function showHome() {
  if (playing) setPlaying(false);
  if (rec) stopRec();
  setInk(false);
  current = ''; setHash(''); leaveBoard();
  lookPop.classList.remove('show'); $('bLook').classList.remove('on');
  if (explorer?.isOpen) explorer.close();
  updateTabs(); persist();
  home.refresh(); home.el.classList.add('show'); home.el.scrollTop = 0;
  status('ready'); problems = []; renderPanel();
}
// ---- board tabs
const boardHost = document.createElement('div'); boardHost.id = 'boardHost'; $('app').appendChild(boardHost);
function leaveBoard() { boardCur = ''; boardHost.classList.remove('show'); }
/** open board mode in a tab: query is "?new=chalkboard", "?open=<id>" or "?do=home" */
function openBoard(query: string, name = 'Board') {
  const id = /[?&]open=([a-z0-9]{6,40})/.exec(query)?.[1];
  const have = id && boardTabs.find(b => b.id === id);
  if (have) { showBoard(have.key); return; }
  const key = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  boardTabs.push({ key, url: './board/' + query + (query.includes('?') ? '&' : '?') + 'embed=1', id, name });
  showBoard(key);
}
function showBoard(key: string) {
  const b = boardTabs.find(x => x.key === key); if (!b) return;
  if (playing) setPlaying(false);
  if (rec) stopRec();
  setInk(false);
  if (explorer?.isOpen) explorer.close();
  current = ''; setHash(''); boardCur = key;
  home.el.classList.remove('show');
  if (!b.frame) {
    const f = document.createElement('iframe'); f.title = b.name; f.src = b.url;
    f.allow = 'clipboard-read; clipboard-write; microphone; display-capture; fullscreen';
    boardHost.appendChild(f); b.frame = f;
  }
  for (const x of boardTabs) x.frame?.classList.toggle('act', x === b);
  boardHost.classList.add('show');
  updateTabs(); persist();
  status('board'); problems = []; renderPanel();
  setTimeout(() => b.frame?.contentWindow?.focus(), 50);
}
/** close a board tab: the board saves to your library first */
async function closeBoard(b: BoardTab) {
  if (b.frame?.contentWindow) {
    const nonce = Math.random().toString(36).slice(2);
    const done = new Promise<void>(res => {
      const t = setTimeout(() => { removeEventListener('message', on); res(); }, 4000);
      const on = (e: MessageEvent) => { if (e.source === b.frame?.contentWindow && e.data?.type === 'lm-board' && e.data.ev === 'saved' && e.data.nonce === nonce) { clearTimeout(t); removeEventListener('message', on); res(); } };
      addEventListener('message', on);
    });
    b.frame.contentWindow.postMessage({ type: 'lm-board-save', nonce }, location.origin);
    await done;
  }
  b.frame?.remove();
  const i = boardTabs.indexOf(b); if (i >= 0) boardTabs.splice(i, 1);
  if (boardCur === b.key) showHome(); else { updateTabs(); persist(); }
}
// what a board tells its tab: its id once saved, and its name
addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'lm-board') return;
  const b = boardTabs.find(x => x.frame && x.frame.contentWindow === e.source); if (!b) return;
  if (e.data.ev === 'state') {
    const id = typeof e.data.id === 'string' && /^[a-z0-9]{6,40}$/.test(e.data.id) ? e.data.id : b.id;
    const name = typeof e.data.name === 'string' && e.data.name.trim() ? e.data.name.trim().slice(0, 80) : b.name;
    if (id !== b.id || name !== b.name) { b.id = id; b.name = name; if (b.frame) b.frame.title = name; updateTabs(); persist(); }
  } else if (e.data.ev === 'home') showHome();
});

function addDoc(name: string, text: string, path?: string, saved = text, extra: Partial<Doc> = {}) {
  let n = name, k = 2; while (docs.some(d => d.name === n && d.path === path)) n = name.replace(/(-\d+)?(\.bd)?$/, `-${k++}.bd`);
  const d: Doc = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, text, saved, path, ...extra };
  docs.push(d); openDoc(d.id); return d;
}
/** open an example from the library (or switch to it if it's already open) */
function openExample(e: LibItem) {
  const open = docs.find(d => d.example && d.src === e.key);
  if (open) { openDoc(open.id); return; }
  addDoc(e.file, e.src, undefined, e.src, { example: true, src: e.key });
}
async function closeDoc(d: Doc) {
  if (isDirty(d)) {
    const r = await ask(`Close “${d.name}”?`, d.example ? 'You changed this example. Closing it throws your changes away (the example itself is kept).' : 'It has changes that are not saved to a file.',
      ['Cancel', d.example ? 'Save a copy' : 'Save', 'Close without saving']);
    if (r === 'Cancel' || r === null) return;
    if (r !== 'Close without saving' && !(await saveDoc(d))) return;
  }
  const i = docs.indexOf(d); if (i < 0) return;
  docs = docs.filter(x => x !== d);
  if (current === d.id) { const next = docs[Math.min(i, docs.length - 1)]; next ? openDoc(next.id) : showHome(); }
  else { updateTabs(); persist(); }
}
async function saveDoc(d = doc(), saveAs = false): Promise<boolean> {
  if (!d) { toast('open a page first'); return false; }
  try {
    const r = await platform.saveFile(d.name, joinInk(d.text, d.ink), d.example ? undefined : d.path, saveAs || !!d.example);
    if (!r) return false;
    if (d.example) {   // an example is never overwritten: the saved file becomes its own page and the example goes back to normal
      const text = d.text; d.text = original(d) ?? d.text;
      const i = docs.indexOf(d); const nd: Doc = { id: 'd' + Date.now().toString(36), name: r.name, text, saved: text, path: r.path, ink: d.ink, inkSaved: d.ink?.length ? JSON.stringify(d.ink) : undefined };
      d.ink = undefined;   // the ink went with the saved copy
      docs.splice(i + 1, 0, nd); if (current === d.id) openDoc(nd.id);
      if (d.text === original(d) && i >= 0) docs.splice(docs.indexOf(d), 1);   // the untouched example tab isn't needed any more
    }
    else { d.name = r.name; d.path = r.path; d.saved = d.text; d.inkSaved = inkKey(d) || undefined; }
    updateTabs(); persist(); toast(platform.kind === 'desktop' ? `saved ${r.path ?? r.name}` : `downloaded ${r.name}`);
    return true;
  } catch (e: any) { toast('save failed: ' + (e.message || e)); return false; }
}

// ---- the start screen
const thumbs = new Thumbs();
const home = new Home($('app'), {
  thumbs,
  openDocs: () => docs.map(d => ({ id: d.id, name: d.name, text: d.text, dirty: isDirty(d), where: d.example ? 'example · ' + (byKey(d.src)?.title ?? '') : d.path ?? 'not saved to a file yet' })),
  resume: id => openDoc(id),
  create: (name, src) => { addDoc(name, src, undefined, src); },
  openExample,
  model: tex => { mIn.value = tex; modelIt(); },
  openFile: () => $('bOpen').click(),
  importTikz: () => importTikzDialog(),
  openBoard: (q: string, name?: string) => openBoard(q, name),
  write: () => openWritePad({ action: 'Model it', onUse: tex => { mIn.value = tex; modelIt(); } }),
  quickEquations: ['ripple', 'heart', 'torus', 'helix', 'rotation field', 'logistic ODE', 'Gaussian integral', 'limit: sin x / x', 'Basel series'].map(l => MODEL_EXAMPLES.find(e => e.label === l)!).filter(Boolean),
});
home.el.classList.add('show');

// ------------------------------------------------------------------ modal / toast
function modal(html: string) { $('mbox').innerHTML = html; $('modal').classList.add('show'); }
function closeModal() { $('modal').classList.remove('show'); }
$('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
function ask(title: string, body: string, buttons: string[]): Promise<string | null> {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><p>${esc(body)}</p><div class="row">${buttons.map((b, i) => `<button class="vbtn ${i === buttons.length - 1 ? 'primary' : ''}" data-b="${esc(b)}">${esc(b)}</button>`).join('')}</div>`);
    $('mbox').querySelectorAll('button').forEach(b => (b.onclick = () => { closeModal(); res((b as HTMLElement).dataset.b!); }));
  });
}
let toastT = 0;
function toast(msg: string) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = window.setTimeout(() => t.classList.remove('show'), 2600); }

// ------------------------------------------------------------------ panel & status
let panelTab = 'problems', problems: { sev: 'e' | 'w'; line: number; msg: string }[] = [], output: { line: number; text: string }[] = [];
document.querySelectorAll<HTMLElement>('.ptab').forEach(el => el.onclick = () => {
  panelTab = el.dataset.p!; document.querySelectorAll('.ptab').forEach(x => x.classList.toggle('act', x === el));
  $('panel').classList.remove('collapsed'); renderPanel();
});
$('pcoll').onclick = () => { const p = $('panel'); p.classList.toggle('collapsed'); $('pcoll').textContent = p.classList.contains('collapsed') ? '▴' : '▾'; };
function renderPanel() {
  const pc = $('pcount'); pc.textContent = String(problems.length); pc.classList.toggle('bad', problems.some(p => p.sev === 'e'));
  const body = $('pbody');
  if (panelTab === 'problems') {
    if (!problems.length) { body.innerHTML = '<div class="ok">✓ No problems — the page compiled cleanly.</div>'; return; }
    body.innerHTML = problems.map((p, i) => `<div class="prob" data-i="${i}"><span class="sev ${p.sev}">${p.sev === 'e' ? '⨯ error' : '⚠ warning'}</span><span>${esc(p.msg)}</span>${p.line ? `<span class="loc">[Ln ${p.line}]</span>` : ''}</div>`).join('');
    body.querySelectorAll<HTMLElement>('.prob').forEach(el => el.onclick = () => { const p = problems[+el.dataset.i!]; if (p.line) editor.goTo(p.line); });
  } else if (panelTab === 'output') {
    body.innerHTML = output.length ? output.map(o => `<div class="out"><span class="loc" style="color:#777">[${o.line}]</span> ${esc(o.text)}</div>`).join('') : '<div style="color:#777">print(…) output appears here.</div>';
  } else body.innerHTML = REFERENCE;
}
let lastStatus = 'ready', statusT = 0;
function status(msg: string, bad = false) { lastStatus = msg; $('sMsg').textContent = msg; $('status').classList.toggle('bad', bad); }
function flashStatus(msg: string) { $('sMsg').textContent = msg; clearTimeout(statusT); statusT = window.setTimeout(() => ($('sMsg').textContent = lastStatus), 2200); }

// ------------------------------------------------------------------ compile + timeline
/** what the page is run with besides time: the reader's slider values and the slide being shown */
const runHooks = () => { const d = doc(); return { measure: measureTex, sliders: d?.vals, slide: d?.slide ?? 0 }; };
let tCur = 0, duration = 6, playing = false, usesT = false, lastCtx: RunCtx | null = null, firstFit = true, followCam = true;
const slider = $<HTMLInputElement>('slider');
function compile(force: boolean) {
  if (!current) return false;
  const t0 = performance.now();
  let ctx: RunCtx;
  try { ctx = runProgram(editor.value, tCur, runHooks()); }
  catch (e: any) {
    const line = e.line || 0;
    problems = [{ sev: 'e', line, msg: e.message }, ...modelWarnings.map(m => ({ sev: 'w' as const, line: 0, msg: m }))];
    editor.setError(line); renderPanel();
    status(`✗ ${e.message}${line ? ` (line ${line})` : ''}`, true);
    return false;
  }
  editor.setError(0);
  const warnings: { line: number; msg: string }[] = [];
  viewer.build(ctx, warnings);
  const d = doc()!;
  if (ctx.slides.length) { d.slide = Math.min(d.slide ?? 0, ctx.slides.length - 1); ink.slide = d.slide; } else ink.slide = undefined;
  ink.redraw();
  controls.update(ctx.controls);
  updateSlides(ctx);   // the paper's depth can change with the page
  chips.update(ctx);
  if (!playing && !recordingNow) viewer.highlight(editorRecs());
  problems = [...warnings.map(w => ({ sev: 'w' as const, ...w })), ...modelWarnings.map(m => ({ sev: 'w' as const, line: 0, msg: m }))];
  lastCtx = ctx; usesT = ctx.usesT; output = ctx.out;
  duration = ctx.duration ?? 6; slider.max = String(duration); if (tCur > duration) tCur = duration;
  renderPanel();
  $('sObj').textContent = `${ctx.prims.length} marks`;
  $('sTime').textContent = `${(performance.now() - t0).toFixed(0)} ms`;
  status(warnings.length ? `⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : '✓ compiled');
  if (lookPop.classList.contains('show')) renderLook();
  if (firstFit) { firstFit = false; viewer.place(0, 0, 1); }
  else if (followCam && ctx.cam && force) applyCam();
  updateTime();
  return true;
}
function tour() {
  if (lastCtx?.cam) return lastCtx.cam;
  if (lastCtx?.slides.length) return { yaw: 0, pitch: 0, zoom: 1 };   // a deck's slides face the audience unless they set view()
  const ph = duration > 0 ? tCur / duration : 0;
  return { yaw: 0.85 * Math.sin(2 * Math.PI * ph), pitch: 0.5 * Math.sin(Math.PI * ph), zoom: 1 + 0.3 * Math.sin(Math.PI * ph) };
}
function applyCam() { const c = tour(); viewer.place(c.yaw, c.pitch, c.zoom); }
function updateTime() { slider.value = String(tCur); $('tval').textContent = `t = ${tCur.toFixed(2)}`; }
function setTime(t: number) { tCur = Math.max(0, Math.min(duration, t)); updateTime(); if (usesT) compile(false); if (followCam) applyCam(); }
slider.addEventListener('input', () => setTime(+slider.value));
function setPlaying(p: boolean) {
  playing = p;
  $('playIc').innerHTML = p ? '<path d="M2 1h3v10H2zM7 1h3v10H7z"/>' : '<path d="M2 1l9 5-9 5z"/>';
  if (p && tCur >= duration - 1e-6) tCur = 0;
  lastFrame = performance.now();
}
$('play').onclick = () => setPlaying(!playing);
function setFollow(f: boolean) { followCam = f; $('bCam').classList.toggle('on', f); if (f) applyCam(); }
$('bCam').onclick = () => setFollow(!followCam);
$('bOrtho').onclick = () => { viewer.setOrtho(!viewer.isOrtho); $('bOrtho').classList.toggle('on', viewer.isOrtho); };
$('bReset').onclick = () => { setFollow(false); viewer.place(0, 0, 1); };
let hintHidden = false;
if (matchMedia('(pointer: coarse)').matches) $('hint').innerHTML = 'drag to orbit · pinch to zoom · two-finger drag to pan<br>tap an element to jump to its code';
viewer.onUserCamera = () => { if (followCam) setFollow(false); if (!hintHidden) { hintHidden = true; setTimeout(() => ($('hint').style.opacity = '0'), 1500); } };

// click → jump to source; hover shows what a click would hit
const tip = $('pickTip'); const glEl = $('gl');
let downAt: { x: number; y: number; t: number } | null = null, hoverQueued = false, lastMove: PointerEvent | null = null, hoverRec: any = null;
const canvas = viewer.renderer.domElement;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; hideTip(); });
canvas.addEventListener('pointerup', e => {
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), dt = performance.now() - downAt.t; downAt = null;
  if (moved > 5 || dt > 600) return;
  const r = viewer.pickAt(e.clientX, e.clientY);
  if (!r) { flashStatus('nothing here — click a line, label, dot or surface'); return; }
  const line = e.altKey ? r.inner : r.line;
  editor.goTo(line);
  flashStatus(r.inner !== r.line ? `line ${line} (Alt+click: line ${e.altKey ? r.line : r.inner})` : `line ${line}`);
});
function hideTip() { tip.style.opacity = '0'; glEl.classList.remove('picking'); if (hoverRec) { hoverRec = null; viewer.highlight(editorRecs()); } }
canvas.addEventListener('pointerleave', hideTip);
canvas.addEventListener('pointermove', e => {
  if (e.buttons) return;
  lastMove = e;
  if (hoverQueued) return; hoverQueued = true;
  setTimeout(() => {
    hoverQueued = false; const ev = lastMove!; if (!ev) return;
    const r = viewer.pickAt(ev.clientX, ev.clientY);
    if (!r) { hideTip(); return; }
    const box = glEl.getBoundingClientRect();
    tip.textContent = r.inner !== r.line ? `Ln ${r.line}  ·  drawn at ${r.inner}` : `Ln ${r.line}`;
    tip.style.left = (ev.clientX - box.left + 14) + 'px'; tip.style.top = (ev.clientY - box.top + 16) + 'px'; tip.style.opacity = '1';
    glEl.classList.add('picking');
    if (r !== hoverRec) { hoverRec = r; viewer.highlight(viewer.picks.filter(p => p.line === r.line && (r.inner === r.line || p.inner === r.inner))); }
  }, 40);
});
// editor cursor → light up what that line draws
let edLine = 0;
const editorRecs = () => (document.activeElement === editor.ta && edLine ? viewer.picks.filter(p => p.line === edLine || p.inner === edLine) : []);
editor.onCursor = (l, c) => {
  $('sPos').textContent = `Ln ${l}, Col ${c}`;
  if (l !== edLine) {
    edLine = l; if (!hoverRec) viewer.highlight(editorRecs());
    if (slideList.length && document.activeElement === editor.ta && slideList[0].line <= l) setSlide(slideAtLine(l), true);
  }
};
editor.ta.addEventListener('blur', () => { if (!hoverRec) viewer.highlight([]); });
editor.ta.addEventListener('focus', () => { if (!hoverRec) viewer.highlight(editorRecs()); });

// editor changes
let compileTimer = 0;
editor.onChange = () => {
  const d = doc(); if (!d) return; d.text = editor.value; persist(); updateTabs();
  clearTimeout(liveDocT); liveDocT = window.setTimeout(() => live?.doc(), 400);
  clearTimeout(compileTimer); compileTimer = window.setTimeout(() => compile(false), 260);
};
editor.onRun = () => compile(true);

// ------------------------------------------------------------------ page look: size, paper and stage
const lookPop = $('lookPop');
const near = (a: number, b: number) => Math.abs(a - b) < 0.6;
function sizeKey(p: { w: number; h: number }): string {
  for (const [k, [w, h]] of Object.entries(PAGES)) { if (near(w, p.w) && near(h, p.h)) return k; if (near(h, p.w) && near(w, p.h)) return k + ' landscape'; }
  return '';
}
const SIZE_MENU: [string, string][] = [['A4', 'A4'], ['A4 landscape', 'A4 ⟷'], ['A5', 'A5'], ['A5 landscape', 'A5 ⟷'], ['A3', 'A3'], ['A3 landscape', 'A3 ⟷'], ['letter', 'Letter'], ['slide', 'Slide 16:9'], ['square', 'Square']];
function renderLook() {
  const pg = lastCtx?.page;
  if (!pg) { lookPop.innerHTML = '<div class="note">Fix the errors in the code first.</div>'; return; }
  const cur = { size: sizeKey(pg), style: pg.style, stage: pg.stage || 'studio' };
  const row = (kind: string, items: [string, string, string?][]) => `<div class="row">${items.map(([v, l, extra]) => `<button class="chip${(cur as any)[kind] === v ? ' on' : ''}" data-k="${kind}" data-v="${esc(v)}"${extra ? ` title="${esc(extra)}"` : ''}>${l}</button>`).join('')}</div>`;
  lookPop.innerHTML = `<h4>Size</h4>${row('size', SIZE_MENU.map(([v, l]) => [v, esc(l)]))}
    <h4>Paper</h4>${row('style', Object.entries(PAGE_STYLES).map(([k, s]) => [k, `<span class="sw" style="background:${s.bg}"></span>${esc(s.label)}`]))}
    <h4>Stage</h4>${row('stage', Object.entries(STAGES).map(([k, s]) => [k, esc(s.label), s.about]))}
    <div class="note">Changes the <code>page(…)</code> line in your code — undo with Ctrl+Z.${cur.size ? '' : ' This page has a custom size.'}</div>`;
  lookPop.querySelectorAll<HTMLElement>('.chip').forEach(b => b.onclick = () => setPageOpt(b.dataset.k as any, b.dataset.v!));
}
function setPageOpt(kind: 'size' | 'style' | 'stage', value: string) {
  const pg = lastCtx?.page; if (!pg) return;
  const cur = { size: sizeKey(pg), style: pg.style, stage: pg.stage || 'studio' }; cur[kind] = value;
  const sizeLit = cur.size ? `"${cur.size}"` : `(${+pg.w.toFixed(2)}, ${+pg.h.toFixed(2)})`;
  const call = `page(${sizeLit}, "${cur.style}"${cur.stage !== 'studio' ? `, {stage: "${cur.stage}"}` : ''})`;
  const text = editor.value, lines = text.split('\n');
  const idx = lines.findIndex(l => /^\s*page\s*\(/.test(l));
  let from: number, to: number, insert: string;
  if (idx >= 0) {
    const m = /^(\s*)page\s*\((.*)\)(\s*\/\/.*)?\s*$/.exec(lines[idx]);
    const simple = m && /^\s*("[^"]*"|\(\s*[-\d.]+\s*,\s*[-\d.]+\s*\))?\s*(,\s*"[^"]*"\s*)?(,\s*\{\s*stage\s*:\s*"[^"]*"\s*\}\s*)?$/.test(m[2]);
    if (!m || !simple) { toast('the page(…) line uses code here — change it by hand'); editor.goTo(idx + 1); return; }
    from = lines.slice(0, idx).join('\n').length + (idx ? 1 : 0); to = from + lines[idx].length;
    insert = m[1] + call + (m[3] ?? '');
  } else {   // no page() yet: add one after the opening comments
    let k = 0; while (k < lines.length && /^\s*\/\//.test(lines[k])) k++;
    from = to = lines.slice(0, k).join('\n').length + (k ? 1 : 0); insert = call + '\n';
  }
  // insert through the browser's editing command so Ctrl+Z can undo it
  const ta = editor.ta, had = document.activeElement;
  let done = false;
  if (!matchMedia('(pointer: coarse)').matches) {
    try { ta.focus({ preventScroll: true }); ta.setSelectionRange(from, to); done = document.execCommand('insertText', false, insert); } catch { done = false; }
    if (had instanceof HTMLElement && had !== ta) had.focus({ preventScroll: true }); else ta.blur();
  }
  if (!done || editor.value === text) { editor.value = text.slice(0, from) + insert + text.slice(to); }
  const d = doc(); if (d) d.text = editor.value; persist(); updateTabs();
  firstFit = true; compile(true); renderLook();
}
$('bLook').onclick = (e) => { e.stopPropagation(); const open = !lookPop.classList.contains('show'); lookPop.classList.toggle('show', open); $('bLook').classList.toggle('on', open); if (open) renderLook(); };
lookPop.addEventListener('pointerdown', e => e.stopPropagation());
document.addEventListener('pointerdown', e => { if (lookPop.classList.contains('show') && !(e.target as HTMLElement).closest('#lookPop, #bLook')) { lookPop.classList.remove('show'); $('bLook').classList.remove('on'); } });

// ------------------------------------------------------------------ auto-model bar
let modelWarnings: string[] = [];
const mIn = $<HTMLInputElement>('mIn'), mEx = $<HTMLSelectElement>('mEx');
for (const ex of MODEL_EXAMPLES) { const o = document.createElement('option'); o.value = ex.tex; o.textContent = ex.label; mEx.appendChild(o); }
let previewTimer = 0, lastModel: { tex: string; r: ModelResult } | null = null;
let modeller: typeof import('./model/generate') | null = null;
const loadModeller = () => import('./model/generate').then(m => (modeller = m));
function runModel(tex: string) { if (lastModel?.tex === tex) return lastModel.r; const r = modeller!.autoModel(tex); lastModel = { tex, r }; return r; }
async function preview() {
  if (!modeller) await loadModeller();
  const tex = mIn.value.trim();
  const box = $('mprev');
  if (!tex) { box.classList.remove('show'); return; }
  box.classList.add('show');
  const { el, err } = previewSVG(tex);
  const eq = $('mEq'); eq.innerHTML = ''; if (el) eq.appendChild(el);
  const kind = $('mKind');
  if (err) { kind.className = 'kind bad'; kind.textContent = 'LaTeX: ' + err; return; }
  const r = runModel(tex);
  if (r.ok) { kind.className = 'kind'; kind.innerHTML = `→ <b>${esc(r.title!)}</b> · ${esc(r.detected!)}${r.warnings.length ? ` · ⚠ ${esc(r.warnings[0])}` : ''} — press Enter`; }
  else { kind.className = 'kind bad'; kind.textContent = '✗ ' + r.error; }
}
mIn.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = window.setTimeout(preview, 280); });
mIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); modelIt(); } });
mEx.addEventListener('change', () => { if (!mEx.value) return; mIn.value = mEx.value; mEx.value = ''; preview(); modelIt(); });
$('mGo').onclick = () => modelIt();
async function modelIt() {
  if (!modeller) { try { await loadModeller(); } catch (e: any) { toast('could not load the modeller: ' + (e?.message || e)); return; } }
  const tex = mIn.value.trim();
  if (!tex) { mIn.focus(); toast('type an equation first, or pick one from Examples'); return; }
  const r = runModel(tex);
  if (!r.ok) { preview(); toast(r.error!); return; }
  const slug = (r.title || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // reuse an untouched model tab instead of piling up tabs
  const reuse = docs.find(d => d.id === current && !d.path && !d.example && d.text === d.saved && /^model-/.test(d.name));
  modelWarnings = r.warnings;
  if (reuse) { reuse.name = `model-${slug}.bd`; reuse.text = reuse.saved = r.code!; openDoc(reuse.id); }
  else addDoc(`model-${slug}.bd`, r.code!, undefined, r.code!);
  followCam = true; $('bCam').classList.add('on');
  flashStatus(`modelled as: ${r.detected}`);
  setTimeout(() => { modelWarnings = []; }, 0);
}

// ------------------------------------------------------------------ files & export
$('bNew').onclick = () => { showHome(); requestAnimationFrame(() => home.scrollToTemplates()); };
$('bOpen').onclick = async () => {
  try { const f = await platform.openFile(); if (!f) return; const ex = docs.find(d => d.path && d.path === f.path); if (ex) { openDoc(ex.id); return; }
    if (/\.(tex|tikz)$/i.test(f.name)) { await importTikzText(f.text, f.name.replace(/\.(tex|tikz)$/i, '.bd')); return; }
    const fd = fileDoc(f.name, f.text, f.path); addDoc(fd.name, fd.text, fd.path, fd.text, fd.extra); }
  catch (e: any) { toast('open failed: ' + (e.message || e)); }
};
$('bSave').onclick = (e) => saveDoc(doc(), (e as MouseEvent).shiftKey);
$('bRevert').onclick = () => { const d = doc(); const o = d && original(d); if (!d || o === undefined) return; d.text = o; openDoc(d.id); toast('back to the original example'); };
const exportMenu = $('exportMenu');
$('bExport').onclick = (e) => { if ((e.target as HTMLElement).closest('.menu')) return; exportMenu.classList.toggle('show'); };
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#bExport')) exportMenu.classList.remove('show'); });
exportMenu.querySelectorAll<HTMLElement>('div').forEach(el => el.onclick = (e) => { e.stopPropagation(); exportMenu.classList.remove('show'); doExport(el.dataset.x!); });
const baseName = () => (doc()?.name ?? 'page').replace(/\.bd$/, '');
const docName = () => doc()?.name ?? 'page.bd';
async function doExport(kind: string) {
  if (!current) { toast('open a page first'); return; }
  if (!lastCtx) { toast('fix the errors first'); return; }
  if (kind === 'html') { await exportHTML(); return; }
  if (kind === 'share') { await exportShare(); return; }
  if (kind === 'live') { await startLive(); return; }
  if (kind === 'pdf') { await exportPDF(); return; }
  if (kind === 'usdz') {
    try { const { toUSDZ } = await import('./render/export3d'); const data = await toUSDZ(viewer.content); if (await platform.exportFile(baseName() + '.usdz', data, 'model/vnd.usdz+zip') && platform.kind === 'desktop') toast('exported ' + baseName() + '.usdz'); }
    catch (e: any) { toast('USDZ export failed: ' + (e?.message || e)); }
    return;
  }
  if (kind === 'tikz') { await exportTikzDialog(); return; }
  if (kind === 'video') { exportVideo(); return; }
  if (kind === 'glb') {
    try { const { toGLB } = await import('./render/export3d'); const data = await toGLB(viewer.content, { skipTextured: true }); await platform.exportFile(baseName() + '.glb', data, 'model/gltf-binary'); if (platform.kind === 'desktop') toast('exported ' + baseName() + '.glb'); }
    catch (e: any) { toast('3D export failed: ' + (e?.message || e)); }
    return;
  }
  if (kind === 'code') { try { await navigator.clipboard.writeText(editor.value); toast('page code copied'); } catch { toast('copy was blocked — select the code and press Ctrl+C'); } return; }
  let name: string, data: string | Uint8Array, mime: string, previewUrl: string;
  if (kind === 'svg') {
    const svg = exportSVG(lastCtx, inkSVG(doc()?.ink, lastCtx.page.h)); name = baseName() + '.svg'; data = svg; mime = 'image/svg+xml';
    previewUrl = URL.createObjectURL(new Blob([svg], { type: mime }));
  } else {
    const url = kind === 'png' ? viewer.snapshotPage(200) : viewer.snapshotView();
    name = baseName() + (kind === 'png' ? '.png' : '-view.png'); mime = 'image/png'; previewUrl = url;
    const bin = atob(url.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); data = u8;
  }
  if (platform.kind === 'desktop') { try { if (await platform.exportFile(name, data, mime)) toast('exported ' + name); } catch (e: any) { toast('export failed: ' + (e.message || e)); } return; }
  // web: preview with download + copy (some embedded viewers block downloads)
  modal(`<h3>${esc(name)}</h3><img src="${previewUrl}" alt="export preview"><div class="row"><span>If the download is blocked here, right-click the image to save it${kind === 'svg' ? ', or copy the SVG code' : ''}.</span>
    ${kind === 'svg' ? '<button class="vbtn" id="xCopy">Copy SVG code</button>' : '<button class="vbtn" id="xCopy">Copy image</button>'}<button class="vbtn" id="xClose">Close</button><button class="vbtn primary" id="xDl">Download</button></div>`);
  $('xClose').onclick = closeModal;
  $('xDl').onclick = () => platform.exportFile(name, data, mime);
  $('xCopy').onclick = async () => {
    try {
      if (kind === 'svg') await navigator.clipboard.writeText(data as string);
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([data as BlobPart], { type: 'image/png' }) })]);
      toast('copied');
    } catch { toast('copy was blocked here — use Download or right-click'); }
  };
}

// one self-contained .html: MathJax + the player bundle + this page's code, viewable offline in 3D
/** every LaTeX label a page needs: on the page across its timeline, and in each figure's explorer view */
let labelMemo: { source: string; r: { tex: Record<string, string>; complete: boolean } } | null = null;
async function collectLabels(source: string): Promise<{ tex: Record<string, string>; complete: boolean }> {
  if (labelMemo?.source === source) return labelMemo.r;
  const r = await collectLabelsNow(source); labelMemo = { source, r }; return r;
}
async function collectLabelsNow(source: string): Promise<{ tex: Record<string, string>; complete: boolean }> {
  const { explorerScene } = await import('./explore/explorer');
  const t0 = performance.now(); const first = runProgram(source, 0, runHooks()); const cost = performance.now() - t0;
  // sample the timeline densely for light pages, more sparsely for heavy ones (keeps export to a few seconds)
  const dur = first.duration ?? 6, N = first.usesT ? Math.max(16, Math.min(60, Math.round(2500 / Math.max(1, cost)))) : 0;
  const visit = (t: number, explore: boolean) => {
    const ctx = runProgram(source, t, runHooks());
    for (const p of ctx.prims) if (p.kind === 'tex') getTex(p.src, p.display);
    if (explore) for (let i = 0; i < ctx.frames.length; i++) {
      const sc = explorerScene(ctx, i, null, null, false);   // sampling density doesn't change labels
      if (!('error' in sc)) for (const p of sc.prims) if (p.kind === 'tex') getTex(p.src, p.display);
    }
  };
  recordTex();
  try { for (let k = 0; k <= N; k++) visit(N ? dur * k / N : 0, k % 15 === 0); }
  finally { var tex = stopRecordingTex(); }
  // spot-check between the samples: if new labels show up there, the page has continuously changing text
  let complete = true;
  if (N) {
    recordTex();
    try { for (let k = 0; k < 12; k++) visit(dur * (k + 0.37) / 12, false); } finally { const extra = stopRecordingTex(); complete = Object.keys(extra).every(k => k in tex); }
  }
  return { tex, complete };
}
// one self-contained .html: the player bundle + this page's code; MathJax in full, or (compact) just the labels it uses
async function buildStandaloneHTML(name: string, source: string, mode: 'full' | 'compact' = 'full', ink?: Stroke[]): Promise<string> {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.text(); };
  const [player, mathjax] = await Promise.all([get('./player/player.js'), mode === 'full' ? get('./vendor/tex-svg-full.js') : Promise.resolve('')]);
  const safe = (js: string) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const json = (o: any) => JSON.stringify(o).replace(/</g, '\\u003c');
  const strokes = ink ? JSON.parse(joinInk('', ink).slice(7)) : undefined;   // NaN → null, numbers rounded
  const doc = json({ name, source, ink: strokes, exported: new Date().toISOString().slice(0, 10) });
  const labels = mode === 'compact' ? (await collectLabels(source)).tex : null;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name.replace(/\.bd$/, ''))} — LaTeX Modeler</title>
<!-- Exported from LaTeX Modeler. ${mode === 'full' ? 'Everything needed is inside this file: open it in any modern browser, no internet required.' : 'Compact export: the LaTeX labels are pre-rendered inside this file; only new labels (e.g. after zooming in the explorer) need an internet connection.'} -->
<!-- LaTeX Modeler player © smplesco, all rights reserved. Includes MathJax (Apache License 2.0, © The MathJax Consortium, https://www.mathjax.org) and three.js (MIT License, © three.js authors, https://threejs.org). The page content belongs to its author. -->
<script>window.MathJax={loader:{load:[]},svg:{fontCache:'none'},options:{enableMenu:false,renderActions:{assistiveMml:[]}},startup:{typeset:false}};</script>
${mode === 'full' ? `<script>${safe(mathjax)}</script>` : `<script>window.__TEX_SVG=${json(labels)};</script>`}
<script>window.__LATEX_MODELER_DOC=${doc};</script>
</head>
<body>
<script>${safe(player)}</script>
</body>
</html>
`;
}
async function exportHTML() {
  const name = baseName() + '.html';
  toast('building the interactive page…');
  let full: string, compact: string, complete = true;
  try {
    full = await buildStandaloneHTML(docName(), editor.value, 'full', doc()?.ink);
    compact = await buildStandaloneHTML(docName(), editor.value, 'compact', doc()?.ink);
    complete = (await collectLabels(editor.value)).complete;
  } catch (e: any) { toast('HTML export failed: ' + (e.message || e)); return; }
  const mb = (s: string) => (s.length / 1048576).toFixed(s.length < 1048576 ? 2 : 1);
  const save = (html: string) => platform.exportFile(name, html, 'text/html').then(ok => { if (ok && platform.kind === 'desktop') toast(`exported ${name}`); }).catch((e: any) => toast('export failed: ' + (e.message || e)));
  const url = URL.createObjectURL(new Blob([compact], { type: 'text/html' }));
  modal(`<h3>${esc(name)}</h3><p style="margin:4px 0 8px;line-height:1.5">One file with the page, the 3D viewer, the timeline and the Figure Explorer built in. It opens in Chrome, Edge, Firefox or Safari with nothing to install, and your code is included so readers see exactly this page.</p>
    <p style="margin:0 0 10px;line-height:1.55"><b>Compact · ${mb(compact)} MB</b> — every label on this page is pre-rendered inside the file. ${complete ? 'It works offline;' : '<span style="color:#e0a24a">This page has labels that change continuously as it plays, so those need an internet connection;</span>'} new labels made by zooming in the explorer also load from the internet (offline they stay blank).<br>
    <b>Full · ${mb(full)} MB</b> — includes the complete LaTeX engine, so everything works offline, always.</p>
    <div class="row"><button class="vbtn" id="xOpen">Preview</button><button class="vbtn" id="xClose">Close</button><button class="vbtn" id="xFull">Download full</button><button class="vbtn primary" id="xCompact">Download compact</button></div>`);
  $('xClose').onclick = () => { closeModal(); URL.revokeObjectURL(url); };
  $('xOpen').onclick = () => window.open(url, '_blank');
  $('xFull').onclick = () => save(full);
  $('xCompact').onclick = () => save(compact);
}
(window as any).__buildHTML = buildStandaloneHTML;

// ---- video / GIF: render the view frame by frame while the camera moves and/or the timeline plays
let recordingNow = false;
function exportVideo() {
  if (!lastCtx) { toast('fix the errors first'); return; }
  const fmts = supportedFormats(); const anim = usesT || !!lastCtx.cam;
  const fmtLabel: Record<RecFormat, string> = { mp4: 'MP4 video', webm: 'WebM video', gif: 'Animated GIF' };
  modal(`<h3>Record a video</h3>
    <div class="vgrid" style="display:grid;grid-template-columns:110px 1fr;gap:8px 12px;align-items:center;margin:8px 0 12px">
      <label>Motion</label><select id="vMotion">
        ${anim ? '<option value="anim">Play the page\'s animation (camera as on screen)</option><option value="tour">Play the animation with the camera tour</option>' : ''}
        <option value="swing">Swing around the page</option><option value="turn">Full turn around the page</option></select>
      <label>Length</label><span><input id="vLen" type="number" min="1" max="60" step="0.5" value="${anim ? (+duration.toFixed(2)) : 6}" style="width:70px"> seconds</span>
      <label>Size</label><select id="vSize"><option value="1280x720">1280 × 720 (HD)</option><option value="1920x1080">1920 × 1080 (Full HD)</option><option value="1080x1080">1080 × 1080 (square)</option><option value="1080x1350">1080 × 1350 (portrait)</option><option value="640x360">640 × 360 (small)</option></select>
      <label>Format</label><select id="vFmt">${fmts.map(f => `<option value="${f}">${fmtLabel[f]}</option>`).join('')}</select>
    </div>
    <div id="vProg" style="display:none;height:6px;background:#333;border-radius:3px;overflow:hidden;margin:6px 0 10px"><div style="height:100%;width:0;background:#36b4ff"></div></div>
    <div id="vOut"></div>
    <div class="row"><span id="vInfo">${fmts.includes('mp4') ? 'MP4 plays everywhere (phones, PowerPoint, YouTube).' : 'This browser can\'t make MP4; WebM plays in browsers and on YouTube.'} GIFs are larger and limited to 256 colours.</span>
      <button class="vbtn" id="vClose">Close</button><button class="vbtn primary" id="vGo">Record</button></div>`);
  const fmtSel = $<HTMLSelectElement>('vFmt'), sizeSel = $<HTMLSelectElement>('vSize');
  fmtSel.onchange = () => { if (fmtSel.value === 'gif' && sizeSel.value !== '640x360') sizeSel.value = '640x360'; };
  let cancel = false, busy = false;
  $('vClose').onclick = () => { if (busy) { cancel = true; return; } closeModal(); };
  $('vGo').onclick = async () => {
    if (busy) return; busy = true; cancel = false;
    const motion = $<HTMLSelectElement>('vMotion').value, fmt = fmtSel.value as RecFormat;
    const [W, H] = sizeSel.value.split('x').map(Number), secs = Math.max(1, Math.min(60, +$<HTMLInputElement>('vLen').value || 6));
    const fps = fmt === 'gif' ? 15 : 30, frames = Math.round(secs * fps);
    const bar = $('vProg'); bar.style.display = ''; const fill = bar.firstElementChild as HTMLElement;
    $('vGo').textContent = 'Recording…'; $('vClose').textContent = 'Cancel'; $('vOut').innerHTML = '';
    // remember the view and time so they can be put back afterwards
    const cam = viewer.camera, saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), zoom: (cam as any).zoom, target: viewer.controls.target.clone(), t: tCur, playing, follow: followCam };
    setPlaying(false); viewer.highlight([]); recordingNow = true;
    const animDur = duration || secs;
    try {
      const res = await record(viewer, {
        width: W, height: H, fps, frames, format: fmt, cancelled: () => cancel,
        onProgress: f => { fill.style.width = (f * 100).toFixed(1) + '%'; },
        setFrame: i => {
          const u = i / frames;
          if (motion === 'anim' || motion === 'tour') {
            tCur = (animDur * i / frames) % animDur; updateTime(); if (usesT) compile(false);
            if (motion === 'tour' || lastCtx?.cam) applyCam(); else viewer.controls.update();
          } else if (motion === 'swing') viewer.place(0.85 * Math.sin(2 * Math.PI * u), 0.22 + 0.12 * Math.sin(4 * Math.PI * u), 1);
          else viewer.place(2 * Math.PI * u, 0.3, 1.05);
        },
      });
      if (res) {
        const name = baseName() + '.' + res.ext;
        const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: res.mime }));
        $('vOut').innerHTML = (res.ext === 'gif' ? `<img src="${url}" style="max-width:100%;max-height:300px;display:block;margin:0 auto 10px">` : `<video src="${url}" controls autoplay loop muted style="max-width:100%;max-height:300px;display:block;margin:0 auto 10px"></video>`)
          + `<div class="row"><span>${esc(name)} · ${res.data.length < 1048576 ? Math.max(1, Math.round(res.data.length / 1024)) + " KB" : (res.data.length / 1048576).toFixed(1) + " MB"}</span><button class="vbtn primary" id="vSave">Download</button></div>`;
        $('vSave').onclick = () => platform.exportFile(name, res.data, res.mime).then(ok => { if (ok && platform.kind === 'desktop') toast('saved ' + name); });
      } else toast('recording cancelled');
    } catch (e: any) { toast('recording failed: ' + (e?.message || e)); }
    finally {
      busy = false; recordingNow = false; bar.style.display = 'none'; fill.style.width = '0';
      const b = document.getElementById('vGo'); if (b) b.textContent = 'Record again'; const c = document.getElementById('vClose'); if (c) c.textContent = 'Close';
      tCur = saved.t; updateTime(); if (usesT) compile(false);
      const cm = viewer.camera; cm.position.copy(saved.pos); cm.quaternion.copy(saved.quat); cm.up.copy(saved.up); if (saved.zoom) { (cm as any).zoom = saved.zoom; (cm as any).updateProjectionMatrix?.(); }
      viewer.controls.target.copy(saved.target); viewer.controls.update(); followCam = saved.follow; viewer.dirty = true;
    }
  };
}

// ---- PDF (vector; a deck becomes one page per slide) and TikZ
async function exportPDF() {
  const d = doc(); if (!d || !lastCtx) return;
  toast('making the PDF…');
  try {
    const { svgToPDF } = await import('./render/pdf');
    const n = Math.max(1, slideList.length), pages: { svg: string; w: number; h: number }[] = [];
    for (let k = 0; k < n; k++) {
      // a deck's slides are printed as they end (everything that fades or builds in is there)
      let ctx = lastCtx!;
      if (n > 1) { const h = { measure: measureTex, sliders: d.vals, slide: k }; ctx = runProgram(editor.value, 0, h); if (ctx.usesT) ctx = runProgram(editor.value, ctx.duration ?? 6, h); }
      pages.push({ svg: exportSVG(ctx, inkSVG(d.ink, ctx.page.h, n > 1 ? k : 0)), w: ctx.page.w, h: ctx.page.h });
    }
    const data = await svgToPDF(pages);
    if (await platform.exportFile(baseName() + '.pdf', data, 'application/pdf') && platform.kind === 'desktop') toast('exported ' + baseName() + '.pdf');
    else if (platform.kind === 'web') toast(n > 1 ? `PDF with ${n} slides downloaded` : 'PDF downloaded');
  } catch (e: any) { toast('PDF export failed: ' + (e?.message || e)); console.error(e); }
}
async function exportTikzDialog() {
  const d = doc(); if (!d || !lastCtx) return;
  const { exportTikZ } = await import('./render/tikz');
  const code = exportTikZ(lastCtx, { ink: d.ink, slide: d.slide ?? 0 });
  const big = code.length > 400_000;
  modal(`<h3>TikZ code</h3><p style="margin:4px 0 8px;line-height:1.5">The page${slideList.length ? ' (this slide)' : ''} as a TikZ picture: labels become real LaTeX, so they use your document's fonts. It compiles on its own with pdflatex, or paste the <code>tikzpicture</code> into your document (needs <code>tikz</code> and <code>amsmath</code>).${big ? '<br><span style="color:#e0a24a">This page has detailed 3D surfaces, so the code is long (' + (code.length / 1e6).toFixed(1) + ' MB) and slow to compile. Fewer samples (n) make it shorter.</span>' : ''}</p>
    <textarea id="xTikz" readonly spellcheck="false" style="width:100%;height:240px;box-sizing:border-box;font:11px var(--mono);background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:4px;padding:6px;white-space:pre">${esc(big ? code.slice(0, 20000) + '\n% … (download the file for the rest)' : code)}</textarea>
    <div class="row" style="margin-top:10px"><span>${code.split('\n').length.toLocaleString()} lines</span><button class="vbtn" id="xClose">Close</button><button class="vbtn" id="xCopy">Copy</button><button class="vbtn primary" id="xDl">Download .tex</button></div>`);
  $('xClose').onclick = closeModal;
  $('xCopy').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('TikZ code copied'); } catch { toast('copy was blocked: download the file instead'); } };
  $('xDl').onclick = () => platform.exportFile(baseName() + '.tex', code, 'application/x-tex').then(ok => { if (ok && platform.kind === 'desktop') toast('exported ' + baseName() + '.tex'); });
}
async function importTikzText(text: string, name = 'imported-tikz.bd') {
  try {
    const { importTikZ } = await import('./import/tikz');
    const r = importTikZ(text);
    addDoc(name, r.code, undefined, '');
    if (r.warnings.length) {
      modelWarnings = r.warnings.map(w => 'TikZ import skipped or simplified: ' + w);
      compile(false); setTimeout(() => { modelWarnings = []; }, 0);
      toast(`imported, with ${r.warnings.length} note${r.warnings.length > 1 ? 's' : ''}: see Problems`);
    } else toast('imported: the page is plain code now, edit it freely');
    return true;
  } catch (e: any) { toast('could not import: ' + (e?.message || e)); return false; }
}
function importTikzDialog() {
  modal(`<h3>Import TikZ or pgfplots</h3><p style="margin:4px 0 8px;line-height:1.5">Paste a <code>tikzpicture</code> (or just its <code>\\draw</code>, <code>\\node</code>, <code>\\addplot</code> lines). You get an editable LaTeX Modeler page you can orbit, animate and export. Lines, shapes, arcs, nodes, <code>\\foreach</code>, plots and pgfplots axes (2D and <code>\\addplot3</code> surfaces) come across; anything else is listed under Problems.</p>
    <textarea id="xTin" spellcheck="false" placeholder="\\begin{tikzpicture}&#10;  \\draw[->] (0,0) -- (2,1) node[right] {$v$};&#10;\\end{tikzpicture}" style="width:100%;height:220px;box-sizing:border-box;font:12px var(--mono);background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:4px;padding:6px"></textarea>
    <div class="row" style="margin-top:10px"><span>or open a .tex file with Open…</span><button class="vbtn" id="xClose">Cancel</button><button class="vbtn primary" id="xImp">Import</button></div>`);
  const ta = $<HTMLTextAreaElement>('xTin'); ta.focus();
  $('xClose').onclick = closeModal;
  $('xImp').onclick = async () => { if (!ta.value.trim()) { ta.focus(); return; } if (await importTikzText(ta.value)) closeModal(); };
}

// ---- share links: the page's code travels inside the link itself
async function exportShare() {
  let url: string;
  try { url = await shareLink(docName(), joinInk(editor.value, doc()?.ink)); } catch (e: any) { toast('could not make a link: ' + (e.message || e)); return; }
  let copied = false; try { await navigator.clipboard.writeText(url); copied = true; } catch { /* blocked: the dialog lets them copy */ }
  const long = url.length > 8000;
  modal(`<h3>Share link</h3><p style="margin:4px 0 10px;line-height:1.5">${copied ? '<b>Copied.</b> ' : ''}Anyone who opens this link sees this page live in LaTeX Modeler and can orbit, explore and edit their own copy.
    The code is inside the link itself (after the <code>#</code>), so nothing is uploaded anywhere.${long ? `<br><span style="color:#e0a24a">This page is large: the link is ${(url.length / 1000).toFixed(0)}k characters, which some chat apps cut short. Interactive HTML export is safer for big pages.</span>` : ''}</p>
    <input id="xLink" readonly style="width:100%;box-sizing:border-box;font:12px var(--mono);padding:6px;background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:4px" value="${esc(url)}">
    <div class="row" style="margin-top:10px"><span>${url.length.toLocaleString()} characters</span><button class="vbtn" id="xClose">Close</button><button class="vbtn" id="xOpen">Open in new tab</button><button class="vbtn primary" id="xCopy">Copy link</button></div>`);
  const inp = $<HTMLInputElement>('xLink'); inp.onfocus = () => inp.select();
  $('xClose').onclick = closeModal;
  $('xOpen').onclick = () => window.open(url, '_blank');
  $('xCopy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('link copied'); } catch { inp.focus(); inp.select(); toast('press Ctrl+C to copy'); } };
}
/** open a share link from the address bar (on start-up, or pasted into an open app) */
async function openShared(hash: string): Promise<boolean> {
  let sh: { name: string; source: string } | null = null;
  try { sh = await readShare(hash); } catch (e: any) { toast('this share link is damaged: ' + (e.message || e)); return false; }
  if (!sh) return false;
  const fd = fileDoc(sh.name, sh.source), key = fd.extra.inkSaved ?? '';
  const same = docs.find(d => d.text === fd.text && inkKey(d) === key);
  if (same) openDoc(same.id); else addDoc(fd.name, fd.text, undefined, fd.text, fd.extra.ink ? { ink: fd.extra.ink } : {});
  flashStatus('opened a shared page'); toast(`opened shared page “${docName()}” — it's your own copy now`);
  return true;
}
window.addEventListener('hashchange', () => {
  const wt = parseWatch(location.hash); if (wt) { if (!watching) startWatching(wt); return; }
  if (/^#s=/.test(location.hash)) { openShared(location.hash); return; }
  let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  if (!h) { if (current) showHome(); return; }
  const open = docs.find(d => slug(d.name) === h), ex = LIBRARY.find(e => slug(e.file) === h || e.key === h);
  if (open) { if (open.id !== current) openDoc(open.id); } else if (ex) openExample(ex);
});

async function exportImage(url: string, name: string) {
  const bin = atob(url.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  if (platform.kind === 'desktop') { if (await platform.exportFile(name, u8, 'image/png')) toast('saved ' + name); return; }
  modal(`<h3>${esc(name)}</h3><img src="${url}" alt="snapshot"><div class="row"><span>Right-click the image to save it if the download is blocked.</span><button class="vbtn" id="xClose">Close</button><button class="vbtn primary" id="xDl">Download</button></div>`);
  $('xClose').onclick = closeModal; $('xDl').onclick = () => platform.exportFile(name, u8, 'image/png');
}

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc(doc(), e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('bOpen').click(); return; }
  if (mod && e.key.toLowerCase() === 'm') { e.preventDefault(); if (!current) home.focusEquation(); else { mIn.focus(); mIn.select(); } return; }
  if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('bNew').click(); return; }
  if (e.key === 'Escape') { closeModal(); exportMenu.classList.remove('show'); lookPop.classList.remove('show'); $('bLook').classList.remove('on'); if (ink.on && !rec) setInk(false); }
  if (!current) return;   // the start screen has no viewer shortcuts
  const typing = document.activeElement === editor.ta || document.activeElement === mIn || (document.activeElement as HTMLElement)?.tagName === 'SELECT';
  if (ink.on && mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); ink.undo(); return; }
  if (typing || mod || e.altKey) return;
  if (e.key === 'i' || e.key === 'I') { setInk(!ink.on); return; }
  if (ink.on && /^[phl]$/i.test(e.key)) { pickTool(({ p: 'pen', h: 'hl', l: 'laser' } as const)[e.key.toLowerCase() as 'p' | 'h' | 'l']); return; }
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'f' || e.key === 'F') $('bReset').click();
  else if (e.key === 'o' || e.key === 'O') $('bOrtho').click();
  else if ((e.key === 'e' || e.key === 'E') && !explorer?.isOpen && chips.first()) openExplore(chips.first()!);
  else if ((e.key === 'PageDown' || e.key === 'PageUp') && slideList.length) { e.preventDefault(); setSlide((doc()?.slide ?? 0) + (e.key === 'PageDown' ? 1 : -1)); }
  else if (e.key === 'F5' && slideList.length) { e.preventDefault(); startPresenting(); }
});

// ------------------------------------------------------------------ splitter
const split = $('split'), main = $('main');
split.addEventListener('pointerdown', e => {
  split.setPointerCapture(e.pointerId); split.classList.add('drag');
  const mv = (ev: PointerEvent) => { const r = main.getBoundingClientRect(); main.style.setProperty('--edw', Math.min(75, Math.max(18, (ev.clientX - r.left) / r.width * 100)) + '%'); };
  const up = () => { split.classList.remove('drag'); split.removeEventListener('pointermove', mv); split.removeEventListener('pointerup', up); editor.refresh(); };
  split.addEventListener('pointermove', mv); split.addEventListener('pointerup', up);
});

// ------------------------------------------------------------------ ink, laser and live recording
const inkBar = $('inkBar');
if (matchMedia('(pointer: coarse)').matches) inkBar.querySelector('.inote')!.textContent = 'one finger draws · two fingers turn and zoom';
ink.onChange = () => { const d = doc(); if (!d) return; d.ink = ink.strokes.length ? ink.strokes.map(s => ({ ...s, pts: s.pts.map(v => +v.toFixed(2)) })) : undefined; persist(); updateTabs(); live?.doc(); };
function setInk(on: boolean) {
  if (on && !current) return;
  ink.setOn(on); inkBar.classList.toggle('show', on); $('bInk').classList.toggle('on', on); $('gl').classList.toggle('inking', on);
  if (on) { followCam = false; $('bCam').classList.remove('on'); syncSwatch(); }
}
function pickTool(t: 'pen' | 'hl' | 'laser') {
  ink.tool = t;
  inkBar.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t === 'hl') ink.color = '#ffd400'; else if (t === 'pen') syncSwatch();
}
let swatch = '#e5484d';
function syncSwatch() {
  const dark = !!(lastCtx && PAGE_STYLES[lastCtx.page.style]?.dark);
  if (ink.tool === 'pen') ink.color = swatch === 'ink' ? (dark ? '#f4f4f4' : '#111111') : swatch;
  inkBar.querySelectorAll<HTMLElement>('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === swatch));
}
inkBar.querySelectorAll<HTMLElement>('.sw').forEach(b => b.onclick = () => { swatch = b.dataset.c!; pickTool('pen'); syncSwatch(); });
inkBar.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.onclick = () => pickTool(b.dataset.tool as any));
inkBar.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'undo') ink.undo();
  else if (a === 'clear') ink.clear();
  else if (a === 'done') { if (rec) stopRec(); setInk(false); }
  else if (a === 'rec') rec ? stopRec() : startRec();
});
$('bInk').onclick = () => setInk(!ink.on);

/* live recording: whatever happens in the viewer (orbiting, ink, the laser, the timeline playing), straight to a video file */
let rec: { mr: MediaRecorder; chunks: Blob[]; mic: MediaStream | null; t0: number; timer: number; type: string } | null = null;
function recType(): string {
  for (const t of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
async function startRec() {
  const type = recType();
  if (!type || !(viewer.renderer.domElement as any).captureStream) { toast("this browser can't record the viewer: use Export → Video instead"); return; }
  let mic: MediaStream | null = null;
  if (($('inkMic') as HTMLInputElement).checked) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('no microphone: recording without sound'); }
  }
  const stream = (viewer.renderer.domElement as HTMLCanvasElement).captureStream(30);
  if (mic) for (const tr of mic.getAudioTracks()) stream.addTrack(tr);
  const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    mic?.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: type.split(';')[0] });
    const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    if (!blob.size) { toast('nothing was recorded'); return; }
    await platform.exportFile(`${baseName()}-recording.${ext}`, new Uint8Array(await blob.arrayBuffer()), type.split(';')[0]);
    toast(`recording saved (${(blob.size / 1e6).toFixed(1)} MB)`);
  };
  mr.start(1000);
  rec = { mr, chunks, mic, t0: performance.now(), type, timer: 0 };
  const b = inkBar.querySelector<HTMLElement>('[data-act=rec]')!; b.classList.add('live'); b.textContent = '■ Stop';
  const tick = () => { if (!rec) return; const s = Math.floor((performance.now() - rec.t0) / 1000); $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  tick(); rec.timer = window.setInterval(tick, 500);
  toast('recording: draw, orbit and talk. Press Stop when you are done');
}
function stopRec() {
  if (!rec) return;
  const r = rec; rec = null; clearInterval(r.timer);
  try { r.mr.stop(); } catch { /* ignore */ }
  const b = inkBar.querySelector<HTMLElement>('[data-act=rec]')!; b.classList.remove('live'); b.textContent = '● Record'; $('recTime').textContent = '';
}

// ------------------------------------------------------------------ sliders and slides
let slideRedraw = 0;
controls.onChange = (name, value) => {
  const d = doc(); if (!d) return;
  if (name === null) d.vals = undefined; else (d.vals ??= {})[name] = value;
  persist();
  cancelAnimationFrame(slideRedraw); slideRedraw = requestAnimationFrame(() => { compile(false); live?.state(); });
};
/** the slides of the latest run, for the slide bar, the presenter window and live viewers */
let slideList: { title: string; notes: string; line: number }[] = [];
function updateSlides(ctx: RunCtx) {
  slideList = ctx.slides;
  const n = ctx.slides.length, k = doc()?.slide ?? 0;
  $('slNav').style.display = n ? '' : 'none'; $('bPresent').style.display = n ? '' : 'none';
  $('slNum').textContent = `${k + 1} / ${n}`;
  ($('slPrev') as HTMLButtonElement).disabled = k <= 0; ($('slNext') as HTMLButtonElement).disabled = k >= n - 1;
  presenter?.update();
}
function setSlide(k: number, fromCursor = false) {
  const d = doc(); if (!d || !slideList.length) return;
  k = Math.max(0, Math.min(slideList.length - 1, k)); if (k === (d.slide ?? 0)) return;
  d.slide = k; persist();
  compile(false);
  // each slide starts from its own camera (view() in the slide) or the flat page
  if (lastCtx?.cam) { setFollow(true); applyCam(); } else { setFollow(false); viewer.place(0, 0, 1); }
  if (!fromCursor && document.activeElement !== editor.ta) editor.goTo(slideList[k].line);
  live?.state();
}
const presenter = new Presenter({
  slides: () => slideList,
  current: () => doc()?.slide ?? 0,
  go: k => setSlide(k),
  shot: k => thumbs.slide(editor.value, { sliders: doc()?.vals, slide: k }),
  name: () => docName(),
  autoplay: () => { tCur = 0; updateTime(); if (usesT) { compile(false); setPlaying(true); } else setPlaying(false); },
  stopped: () => { setPlaying(false); viewer.resize(); },
  blocked: () => toast('allow pop-ups for this site to see your notes, next slide and timer'),
}, $('app'), $('gl'));
function startPresenting() { if (!slideList.length) { toast('this page has no slides: add slide("Title") to make a deck'); return; } if (ink.on) setInk(false); presenter.begin(); }
$('bPresent').onclick = () => startPresenting();
$('slPrev').onclick = () => setSlide((doc()?.slide ?? 0) - 1);
$('slNext').onclick = () => setSlide((doc()?.slide ?? 0) + 1);
/** the editor cursor picks the slide it's in */
function slideAtLine(l: number) { let k = 0; slideList.forEach((s, i) => { if (s.line <= l) k = i; }); return k; }

// ------------------------------------------------------------------ AR
let arKind: 'webxr' | 'quicklook' | null = null;
(async () => {
  try { if ((navigator as any).xr && await (navigator as any).xr.isSessionSupported('immersive-ar')) arKind = 'webxr'; } catch { /* no WebXR */ }
  if (!arKind && document.createElement('a').relList?.supports?.('ar')) arKind = 'quicklook';
  if (arKind) $('bAR').style.display = '';
})();
$('bAR').onclick = async () => {
  if (!lastCtx || !arKind) return;
  if (ink.on) setInk(false);
  try {
    const ar = await import('./render/ar');
    if (arKind === 'webxr') await ar.startWebXR(viewer, lastCtx.page);
    else { toast('opening AR…'); await ar.quickLook(viewer, docName()); }
  } catch (e: any) { toast(e?.message || String(e)); }
};

// ------------------------------------------------------------------ live presenting
let live: LiveHost | null = null, liveDocT = 0;
function camState(): number[] {
  const c = viewer.camera as any, T = viewer.controls.target;
  return [...c.position.toArray(), ...c.quaternion.toArray(), ...c.up.toArray(), ...T.toArray(), c.zoom ?? 1].map((v: number) => +v.toFixed(4));
}
function setCamState(a: number[]) {
  const c = viewer.camera as any;
  c.position.fromArray(a, 0); c.quaternion.fromArray(a, 3); c.up.fromArray(a, 7); viewer.controls.target.fromArray(a, 10);
  if (a[13]) { c.zoom = a[13]; c.updateProjectionMatrix?.(); }
  viewer.controls.update(); viewer.dirty = true;
}
async function startLive() {
  if (!live?.on) {
    live = new LiveHost(
      () => ({ name: docName(), source: joinInk(editor.value, doc()?.ink) }),
      (): LiveState => ({ slide: doc()?.slide ?? 0, t: +tCur.toFixed(3), playing, vals: { ...(doc()?.vals ?? {}) }, cam: camState(), ortho: viewer.isOrtho }));
    live.onChange = () => { const n = live?.viewers ?? 0; $('liveChip').style.display = live?.on ? '' : 'none'; $('liveChip').textContent = `● Live · ${n}`; if ($('xLive')) $('xLiveN').textContent = n === 1 ? '1 person watching' : `${n} people watching`; };
    toast('starting a live session…');
    try { await live.start(); } catch (e: any) { toast(e.message || String(e)); live = null; return; }
  }
  const url = live!.link;
  modal(`<h3 id="xLive">Present live</h3><p style="margin:4px 0 10px;line-height:1.5">Send this link to the people watching. They see this page in their browser and follow your slides, camera, sliders, timeline and ink as you go, until you stop. Edits you make show up for them too.
    Your browser connects straight to theirs; the page isn't uploaded anywhere. Anyone with the link can watch.</p>
    <input id="xLink" readonly style="width:100%;box-sizing:border-box;font:12px var(--mono);padding:6px;background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:4px" value="${esc(url)}">
    <div class="row" style="margin-top:10px"><span id="xLiveN">${live!.viewers} watching</span><button class="vbtn" id="xStop">Stop presenting live</button><button class="vbtn" id="xClose">Close</button><button class="vbtn primary" id="xCopy">Copy link</button></div>`);
  live!.onChange?.();
  const inp = $<HTMLInputElement>('xLink'); inp.onfocus = () => inp.select();
  $('xClose').onclick = closeModal;
  $('xStop').onclick = () => { live?.stop(); live = null; $('liveChip').style.display = 'none'; closeModal(); toast('live session ended'); };
  $('xCopy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('link copied'); } catch { inp.focus(); inp.select(); toast('press Ctrl+C to copy'); } };
}
$('liveChip').onclick = () => startLive();
$('mWrite').onclick = () => openWritePad({ action: 'Model it', onUse: tex => { mIn.value = tex; modelIt(); } });
viewer.onUserCamera = ((prev) => () => { prev(); live?.state(); })(viewer.onUserCamera);

/* watching someone else's page */
let watching: LiveViewer | null = null, wFollow = true;
function startWatching(target: { id: string; key: string }) {
  $('app').classList.add('watching'); viewer.resize();
  setHash('');
  const w = new LiveViewer(target); watching = w;
  const bar = $('watchBar');
  w.onStatus = () => {
    bar.classList.toggle('live', w.status === 'live');
    $('watchMsg').textContent = w.status === 'connecting' ? 'Connecting to the presenter…' : w.status === 'live' ? `Live: ${doc()?.name.replace(/\.bd$/, '') ?? ''}` : w.status === 'ended' ? 'The presenter ended the session. You can keep a copy.' : "Couldn't reach the presenter. The link may be old, or the session has ended.";
  };
  w.onDoc = dd => {
    const { code, ink: strokes } = splitInk(dd.source);
    let d = docs.find(x => x.live);
    if (!d) { d = { id: 'live', name: dd.name, text: code, saved: code, live: true }; docs.push(d); }
    d.name = dd.name; d.text = d.saved = code; d.ink = strokes;
    if (current !== d.id) openDoc(d.id);
    else { editor.value = code; ink.set(d.ink); compile(false); }
    w.onStatus?.();
  };
  w.onState = st => {
    const d = docs.find(x => x.live); if (!d || !wFollow || current !== d.id) return;
    const slideChanged = (d.slide ?? 0) !== st.slide;
    d.slide = st.slide; d.vals = st.vals; tCur = Math.min(st.t, duration); updateTime();
    if (viewer.isOrtho !== st.ortho) { viewer.setOrtho(st.ortho); $('bOrtho').classList.toggle('on', st.ortho); }
    compile(false);
    if (st.cam) { followCam = false; setCamState(st.cam); }
    if (slideChanged && !st.cam) viewer.place(0, 0, 1);
  };
  w.join();
}
const setWFollow = (f: boolean) => { wFollow = f; $('wFollow').classList.toggle('on', f); };
$('wFollow').onclick = () => { setWFollow(!wFollow); if (wFollow) toast('following the presenter again'); };
viewer.onUserCamera = ((prev) => () => { prev(); if (watching && wFollow) { setWFollow(false); toast('you moved the view: press Follow to go back to the presenter'); } })(viewer.onUserCamera);
function stopWatching(keep: boolean) {
  watching?.leave(); watching = null;
  $('app').classList.remove('watching');
  const d = docs.find(x => x.live);
  if (d) { if (keep) { d.live = false; d.id = 'd' + Date.now().toString(36); d.saved = ''; current = d.id; openDoc(d.id); toast('saved as your own copy'); } else { docs = docs.filter(x => x !== d); showHome(); } }
  else showHome();
  viewer.resize(); persist();
}
$('wCopy').onclick = () => stopWatching(true);
$('wLeave').onclick = () => stopWatching(false);

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (playing) { let t = tCur + dt; if (t >= duration) t %= duration; setTime(t); viewer.dirty = true; }
  ink.tick(now);
  if (live?.viewers) live.state();   // throttled, and only sends when something changed
  if (rec) viewer.dirty = true;   // recording: keep frames coming even when nothing moves
  viewer.tick();
  chips.position();
}

async function boot() {
  platform = await getPlatform();
  $('sPlat').textContent = platform.kind === 'desktop' ? 'desktop' : 'web';
  await texReady();
  $('loading').remove();
  loadSession();
  // what to show first: a file the desktop app was opened with, a share link, a link to a page — otherwise the start screen
  // the file the desktop app was launched with is handled once: coming back from board mode doesn't open it again
  let launched = false; try { launched = sessionStorage.getItem('lm-launch-done') === '1'; sessionStorage.setItem('lm-launch-done', '1'); } catch { /* ignore */ }
  const init = launched ? null : await platform.initialFile();
  if (init?.board) { location.replace('./board/?openfile=1'); return; }   // a .screenboard file opens in board mode
  let target = '';
  const shareHash = /^#s=/.test(location.hash) ? location.hash : '';
  const watchTarget = parseWatch(location.hash);
  if (init) { const ex = docs.find(d => d.path === init.path); if (ex) target = ex.id; else { const fd = fileDoc(init.name, init.text, init.path); const d: Doc = { id: 'f' + Date.now(), name: fd.name, text: fd.text, saved: fd.text, path: fd.path, ...fd.extra }; docs.push(d); target = d.id; } }
  else if (!shareHash && !watchTarget) {
    let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* ignore */ }
    if (h) {
      const open = docs.find(d => slug(d.name) === h);
      const ex = LIBRARY.find(e => slug(e.file) === h || e.key === h);
      if (open) target = open.id; else if (ex) openExample(ex);
    }
  }
  renderPanel();
  viewer.resize();
  if (watchTarget) startWatching(watchTarget);
  else if (target) openDoc(target);
  else if (!current && !(shareHash && await openShared(shareHash))) showHome();
  requestAnimationFrame(frame);
  (window as any).__bdraw = { get explorer() { return explorer; }, openExplore, chips, compile, setTime, viewer, get autoModel() { return modeller?.autoModel; }, modelIt, get problems() { return problems; }, get ctx() { return lastCtx; }, exportSVG: () => lastCtx && exportSVG(lastCtx), openDoc, docs: () => docs, editor, get live() { return live; }, setSlide, load: (c: string) => addDoc('test.bd', c, undefined, c), showHome, home, thumbs, openExample };
}
boot().catch(e => { const l = $('loading'); if (l) l.innerHTML = `<div style="color:#f88;padding:20px">Failed to start: ${esc(String(e?.message || e))}</div>`; console.error(e); });
