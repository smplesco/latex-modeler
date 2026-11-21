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
import type { ModelResult } from './model/generate';
import { getPlatform, Platform } from './platform';
import { REFERENCE } from './ui/reference';
import { shareLink, readShare } from './share';
import type { Explorer } from './explore/explorer';
import { FigureChips, type ExploreTarget } from './explore/chips';

import stressSrc from './examples/stress-tensor.bd?raw';
import helixSrc from './examples/frenet-helix.bd?raw';
import saddleSrc from './examples/saddle.bd?raw';
import tourSrc from './examples/plotting-tour.bd?raw';

const EXAMPLES: Record<string, string> = {
  'stress-tensor.bd': stressSrc, 'plotting-tour.bd': tourSrc, 'frenet-helix.bd': helixSrc, 'saddle.bd': saddleSrc,
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ documents
interface Doc { id: string; name: string; text: string; saved: string; path?: string; example?: boolean }
const STORE = 'bdraw.session.v2';
let docs: Doc[] = [], current = '';
function loadSession() {
  try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && Array.isArray(s.docs)) { docs = s.docs; current = s.current; } } catch { /* ignore */ }
  for (const [name, text] of Object.entries(EXAMPLES)) if (!docs.some(d => d.example && d.name === name)) docs.push({ id: 'ex:' + name, name, text, saved: text, example: true });
  docs.sort((a, b) => (a.example === b.example ? 0 : a.example ? -1 : 1));
  if (!docs.some(d => d.id === current)) current = docs[0].id;
  try { const h = decodeURIComponent(location.hash.slice(1)); const d = docs.find(x => x.name.replace(/\.bd$/, '') === h); if (d) current = d.id; } catch { /* ignore */ }
}
let saveTimer = 0;
function persist() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify({ docs, current })); } catch { /* ignore */ } }, 300); }
const doc = () => docs.find(d => d.id === current)!;
const isDirty = (d: Doc) => (d.example ? d.text !== EXAMPLES[d.name] : d.text !== d.saved);

// ------------------------------------------------------------------ UI objects
let platform: Platform;
const editor = new Editor($('editor'));
const viewer = new Viewer($('gl'));
// ---- Figure Explorer: open any figure as a live 3D / 2D graph
// the Figure Explorer is loaded the first time someone opens a figure (keeps start-up light)
let explorer: Explorer | null = null, explorerLoad: Promise<Explorer> | null = null;
const getExplorer = () => (explorerLoad ??= import('./explore/explorer').then(m => (explorer = new m.Explorer($('viewpane'), {
  source: () => editor.value,
  time: () => tCur,
  measure: measureTex,
  title: () => doc().name,
  writeBack: (name, value, line) => {
    const lines = editor.value.split('\n'); const L = lines[line - 1] ?? '';
    const m = new RegExp('^(\\s*' + name + '\\s*=\\s*)(-?[0-9.eE+]+)').exec(L);
    if (!m) { toast(`couldn't find "${name} = …" on line ${line}`); return; }
    lines[line - 1] = m[1] + String(+value.toPrecision(6)) + L.slice(m[0].length);
    const pos = editor.ta.selectionStart; editor.value = lines.join('\n'); editor.ta.setSelectionRange(pos, pos);
    doc().text = editor.value; persist(); updateTabs(); compile(false);
    toast(`${name} = ${+value.toPrecision(6)} written to line ${line}`);
  },
  snapshot: (url, name) => exportImage(url, name),
}))));
const openExplore = (t: ExploreTarget) => getExplorer().then(x => x.openTarget(t)).catch(e => toast('could not open the explorer: ' + (e?.message || e)));
const chips = new FigureChips($('gl'), viewer, openExplore);

function updateTabs() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  for (const d of docs) {
    const el = document.createElement('div');
    el.className = 'tab' + (d.id === current ? ' act' : '') + (isDirty(d) ? ' modified' : '');
    el.innerHTML = `<span class="ic">bd</span><span>${esc(d.name)}</span>${d.example ? '<span class="x" title="modified example"><span></span></span>' : '<span class="x" title="Close"><span>×</span></span>'}`;
    el.onclick = (e) => { if ((e.target as HTMLElement).closest('.x') && !d.example) { closeDoc(d); return; } openDoc(d.id); };
    tabs.appendChild(el);
  }
  const d = doc();
  $('crumbDir').textContent = d.example ? 'examples' : d.path ? 'file' : 'unsaved';
  $('crumbName').textContent = d.name;
  $('crumbPath').textContent = d.path ?? '';
  $('bRevert').style.display = d.example ? '' : 'none';
  platform?.setTitle(`${d.name}${isDirty(d) ? ' •' : ''} — LaTeX Modeler`);
}
function openDoc(id: string) {
  current = id; editor.value = doc().text;
  try { history.replaceState(null, '', '#' + doc().name.replace(/\.bd$/, '').replace(/[^A-Za-z0-9-]/g, '-')); } catch { /* ignore */ }
  updateTabs(); persist();
  tCur = 0; firstFit = true; compile(true);
}
function addDoc(name: string, text: string, path?: string, saved = text) {
  let n = name, k = 2; while (docs.some(d => d.name === n && d.path === path)) n = name.replace(/(\.bd)?$/, `-${k++}.bd`);
  const d: Doc = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, text, saved, path };
  docs.push(d); openDoc(d.id); return d;
}
async function closeDoc(d: Doc) {
  if (isDirty(d)) {
    const r = await ask(`Close “${d.name}”?`, 'It has changes that are not saved to a file.', ['Cancel', 'Save', 'Close without saving']);
    if (r === 'Cancel' || r === null) return;
    if (r === 'Save' && !(await saveDoc(d))) return;
  }
  docs = docs.filter(x => x !== d);
  if (current === d.id) openDoc(docs[docs.length - 1].id); else { updateTabs(); persist(); }
}
async function saveDoc(d = doc(), saveAs = false): Promise<boolean> {
  try {
    const r = await platform.saveFile(d.name, d.text, d.example ? undefined : d.path, saveAs || !!d.example);
    if (!r) return false;
    if (d.example) { addDoc(r.name, d.text, r.path); d.text = EXAMPLES[d.name]; }
    else { d.name = r.name; d.path = r.path; d.saved = d.text; }
    updateTabs(); persist(); toast(platform.kind === 'desktop' ? `saved ${r.path ?? r.name}` : `downloaded ${r.name}`);
    return true;
  } catch (e: any) { toast('save failed: ' + (e.message || e)); return false; }
}

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
let tCur = 0, duration = 6, playing = false, usesT = false, lastCtx: RunCtx | null = null, firstFit = true, followCam = true;
const slider = $<HTMLInputElement>('slider');
function compile(force: boolean) {
  const t0 = performance.now();
  let ctx: RunCtx;
  try { ctx = runProgram(editor.value, tCur, { measure: measureTex }); }
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
  chips.update(ctx);
  if (!playing) viewer.highlight(editorRecs());
  problems = [...warnings.map(w => ({ sev: 'w' as const, ...w })), ...modelWarnings.map(m => ({ sev: 'w' as const, line: 0, msg: m }))];
  lastCtx = ctx; usesT = ctx.usesT; output = ctx.out;
  duration = ctx.duration ?? 6; slider.max = String(duration); if (tCur > duration) tCur = duration;
  renderPanel();
  $('sObj').textContent = `${ctx.prims.length} marks`;
  $('sTime').textContent = `${(performance.now() - t0).toFixed(0)} ms`;
  status(warnings.length ? `⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : '✓ compiled');
  if (firstFit) { firstFit = false; viewer.place(0, 0, 1); }
  else if (followCam && ctx.cam && force) applyCam();
  updateTime();
  return true;
}
function tour() {
  if (lastCtx?.cam) return lastCtx.cam;
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
  if (l !== edLine) { edLine = l; if (!hoverRec) viewer.highlight(editorRecs()); }
};
editor.ta.addEventListener('blur', () => { if (!hoverRec) viewer.highlight([]); });
editor.ta.addEventListener('focus', () => { if (!hoverRec) viewer.highlight(editorRecs()); });

// editor changes
let compileTimer = 0;
editor.onChange = () => {
  const d = doc(); d.text = editor.value; persist(); updateTabs();
  clearTimeout(compileTimer); compileTimer = window.setTimeout(() => compile(false), 260);
};
editor.onRun = () => compile(true);

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
$('bNew').onclick = () => addDoc('untitled.bd', 'page("A4", "paper")\n\ntex("\\\\textbf{Untitled}", (105, 270), {size: 20})\n', undefined, '');
$('bOpen').onclick = async () => {
  try { const f = await platform.openFile(); if (!f) return; const ex = docs.find(d => d.path && d.path === f.path); if (ex) { openDoc(ex.id); return; } addDoc(f.name, f.text, f.path); }
  catch (e: any) { toast('open failed: ' + (e.message || e)); }
};
$('bSave').onclick = (e) => saveDoc(doc(), (e as MouseEvent).shiftKey);
$('bRevert').onclick = () => { const d = doc(); if (!d.example) return; d.text = EXAMPLES[d.name]; openDoc(d.id); };
const exportMenu = $('exportMenu');
$('bExport').onclick = (e) => { if ((e.target as HTMLElement).closest('.menu')) return; exportMenu.classList.toggle('show'); };
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#bExport')) exportMenu.classList.remove('show'); });
exportMenu.querySelectorAll<HTMLElement>('div').forEach(el => el.onclick = (e) => { e.stopPropagation(); exportMenu.classList.remove('show'); doExport(el.dataset.x!); });
const baseName = () => doc().name.replace(/\.bd$/, '');
async function doExport(kind: string) {
  if (!lastCtx) { toast('fix the errors first'); return; }
  if (kind === 'html') { await exportHTML(); return; }
  if (kind === 'share') { await exportShare(); return; }
  if (kind === 'code') { try { await navigator.clipboard.writeText(editor.value); toast('page code copied'); } catch { toast('copy was blocked — select the code and press Ctrl+C'); } return; }
  let name: string, data: string | Uint8Array, mime: string, previewUrl: string;
  if (kind === 'svg') {
    const svg = exportSVG(lastCtx); name = baseName() + '.svg'; data = svg; mime = 'image/svg+xml';
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
  const t0 = performance.now(); const first = runProgram(source, 0, { measure: measureTex }); const cost = performance.now() - t0;
  // sample the timeline densely for light pages, more sparsely for heavy ones (keeps export to a few seconds)
  const dur = first.duration ?? 6, N = first.usesT ? Math.max(16, Math.min(60, Math.round(2500 / Math.max(1, cost)))) : 0;
  const visit = (t: number, explore: boolean) => {
    const ctx = runProgram(source, t, { measure: measureTex });
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
async function buildStandaloneHTML(name: string, source: string, mode: 'full' | 'compact' = 'full'): Promise<string> {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.text(); };
  const [player, mathjax] = await Promise.all([get('./player/player.js'), mode === 'full' ? get('./vendor/tex-svg-full.js') : Promise.resolve('')]);
  const safe = (js: string) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const json = (o: any) => JSON.stringify(o).replace(/</g, '\\u003c');
  const doc = json({ name, source, exported: new Date().toISOString().slice(0, 10) });
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
    full = await buildStandaloneHTML(doc().name, editor.value, 'full');
    compact = await buildStandaloneHTML(doc().name, editor.value, 'compact');
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

// ---- share links: the page's code travels inside the link itself
async function exportShare() {
  let url: string;
  try { url = await shareLink(doc().name, editor.value); } catch (e: any) { toast('could not make a link: ' + (e.message || e)); return; }
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
  const same = docs.find(d => d.text === sh!.source);
  if (same) openDoc(same.id); else addDoc(sh.name, sh.source, undefined, sh.source);
  flashStatus('opened a shared page'); toast(`opened shared page “${doc().name}” — it's your own copy now`);
  return true;
}
window.addEventListener('hashchange', () => { if (/^#s=/.test(location.hash)) openShared(location.hash); });

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
  if (mod && e.key.toLowerCase() === 'm') { e.preventDefault(); mIn.focus(); mIn.select(); return; }
  if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('bNew').click(); return; }
  if (e.key === 'Escape') { closeModal(); exportMenu.classList.remove('show'); }
  const typing = document.activeElement === editor.ta || document.activeElement === mIn || (document.activeElement as HTMLElement)?.tagName === 'SELECT';
  if (typing || mod || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'f' || e.key === 'F') $('bReset').click();
  else if (e.key === 'o' || e.key === 'O') $('bOrtho').click();
  else if ((e.key === 'e' || e.key === 'E') && !explorer?.isOpen && chips.first()) openExplore(chips.first()!);
});

// ------------------------------------------------------------------ splitter
const split = $('split'), main = $('main');
split.addEventListener('pointerdown', e => {
  split.setPointerCapture(e.pointerId); split.classList.add('drag');
  const mv = (ev: PointerEvent) => { const r = main.getBoundingClientRect(); main.style.setProperty('--edw', Math.min(75, Math.max(18, (ev.clientX - r.left) / r.width * 100)) + '%'); };
  const up = () => { split.classList.remove('drag'); split.removeEventListener('pointermove', mv); split.removeEventListener('pointerup', up); editor.refresh(); };
  split.addEventListener('pointermove', mv); split.addEventListener('pointerup', up);
});

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (playing) { let t = tCur + dt; if (t >= duration) t %= duration; setTime(t); viewer.dirty = true; }
  viewer.tick();
  chips.position();
}

async function boot() {
  platform = await getPlatform();
  $('sPlat').textContent = platform.kind === 'desktop' ? 'desktop' : 'web';
  await texReady();
  $('loading').remove();
  loadSession();
  const init = await platform.initialFile();
  if (init) { const ex = docs.find(d => d.path === init.path); if (ex) current = ex.id; else { docs.push({ id: 'f' + Date.now(), name: init.name, text: init.text, saved: init.text, path: init.path }); current = docs[docs.length - 1].id; } }
  editor.value = doc().text;
  if (/^#s=/.test(location.hash)) await openShared(location.hash);
  updateTabs(); renderPanel();
  viewer.resize();
  compile(true);
  requestAnimationFrame(frame);
  (window as any).__bdraw = { get explorer() { return explorer; }, openExplore, chips, compile, setTime, viewer, get autoModel() { return modeller?.autoModel; }, modelIt, get problems() { return problems; }, get ctx() { return lastCtx; }, exportSVG: () => lastCtx && exportSVG(lastCtx), openDoc, docs: () => docs };
}
boot().catch(e => { const l = $('loading'); if (l) l.innerHTML = `<div style="color:#f88;padding:20px">Failed to start: ${esc(String(e?.message || e))}</div>`; console.error(e); });
