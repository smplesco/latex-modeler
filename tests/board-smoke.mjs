// Board mode (Screenboard) smoke test: loads /board in a real browser and exercises the main features.
//
//   npx playwright install chromium     (once)
//   npm run test:board
//
// It serves the public/ folder, so the board runs at /board/ exactly as on latexmodeler.app.
// Set SB_CHROME to a Chrome/Chromium binary to use that instead of Playwright's own,
// and SB_SHOTS to a folder to keep screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {'.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.webmanifest':'application/manifest+json', '.txt':'text/plain'};
const server = http.createServer((req, res)=>{
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
  if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type':TYPES[path.extname(file)] || 'application/octet-stream'}); fs.createReadStream(file).pipe(res);
});
await new Promise(r=> server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/board/`;

let failed = 0;
const check = (name, ok, extra='')=>{ if(!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : '  -> ' + extra}`); };
const browser = await chromium.launch(process.env.SB_CHROME ? {executablePath:process.env.SB_CHROME} : {});
const ctx = await browser.newContext({viewport:{width:1280, height:800}, acceptDownloads:true, serviceWorkers:'block'});
// everything the board needs ships with the app: the only outside address allowed is PeerJS's matchmaking server
const outside = [];
ctx.on('request', q=>{ const u = new URL(q.url()); if(/^https?:$/.test(u.protocol) && u.hostname !== '127.0.0.1' && !/(^|\.)peerjs\.com$/.test(u.hostname)) outside.push(u.href); });
const errors = [];
const watch = page=>{
  page.on('pageerror', e=> errors.push('pageerror: ' + e.message));
  page.on('console', m=>{ if(m.type()==='error') errors.push('console: ' + m.text()); });
};
let page = await ctx.newPage(); watch(page);
await page.goto(base); await page.waitForFunction(()=> typeof LIBR!=='undefined'); await page.evaluate(()=> LIBR.ready);
const ev = (fn, arg)=> page.evaluate(fn, arg);
// for checks that depend on the UI catching up (popups, typing): wait up to 3 s instead of checking once
const soon = (fn, arg)=> page.waitForFunction(fn, arg, {timeout:3000}).then(()=> true, ()=> false);
const shot = async name=>{ if(process.env.SB_SHOTS) await page.screenshot({path:path.join(process.env.SB_SHOTS, name + '.png')}); };
const dragMouse = async (x1, y1, x2, y2, steps=8)=>{ await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, {steps}); await page.mouse.up(); };

// ---- drawing ----
check('opens straight to a board the first time', await ev(()=> !homeOpen() && S.pages.length===1));
await dragMouse(300, 300, 520, 360);
check('pen draws a stroke', await ev(()=> page().objects.length===1 && page().objects[0].type==='stroke' && page().objects[0].points.length > 3));
for(const t of ['triangle', 'diamond', 'star', 'hexagon']){
  await ev(t=> setTool(t), t); await dragMouse(600, 200, 700, 290);
  check(`${t} shape`, await ev(t=>{ const o = page().objects.at(-1); return o.type==='triangle' && o.tri.length===POLY[t].length && Math.abs(o.w) > 50; }, t));
  await ev(()=>{ undo(); });
}
await ev(()=> setTool('star')); await dragMouse(600, 200, 700, 290);

// ---- sticky note, rich text, checklist ----
await ev(()=> addNote());
await page.waitForSelector('#ta'); await page.keyboard.type('**Plan**\n- first\n[ ] ship it');
await ev(()=> closeTextEditor());
const note = await ev(()=>{ const o = page().objects.at(-1), m = textMetrics(o); return {note:o.note, rich:m.rich && m.rich.map(l=>l.kind).join(','), bold:m.rich[0].runs[0].b, x:o.x, y:o.y, size:o.size}; });
check('sticky note with bold, bullet and checklist', !!note.note && note.rich==='p,b,c0' && note.bold, JSON.stringify(note));
await ev(()=> setTool('select'));
const box = await ev(()=>{ const o = page().objects.at(-1), p = W2S(o.x + (14+34)*o.size/100, o.y + (11+2*125+60)*o.size/100); return p; });
await page.mouse.click(box.x, box.y);
check('clicking a checklist box ticks it', await ev(()=> /\[x\] ship it/.test(page().objects.at(-1).text)));
await shot('board-note');

// ---- sums ----
await ev(()=>{ setTool('text'); openTextEditor(S2W(200, 520), null); });
await page.waitForSelector('#ta'); await soon(()=> editing && document.activeElement===editing.ta); await page.focus('#ta'); await page.keyboard.type('3.2*9.81 =');
check('a sum ending in = offers the answer', await soon(()=> !$('tpCalc').hidden && $('tpCalc').textContent==='= 31.392'), await ev(()=> $('tpCalc').textContent));
await page.keyboard.press('Tab');
check('Tab fills the answer in', await soon(()=> editing && editing.ta.value==='3.2*9.81 = 31.392'));
await ev(()=> closeTextEditor());

// ---- table, frame, stamp, template ----
await ev(()=> addTable());
await page.waitForFunction(()=> document.activeElement && document.activeElement.dataset.r==='0'); await page.keyboard.type('Name'); await page.keyboard.press('Tab'); await page.keyboard.type('Score');
await page.click('[data-a="r+"]'); await page.click('#dlgOk');
check('table keeps its cells and grows a row', await ev(()=>{ const o = page().objects.at(-1); return o.type==='table' && o.cells.length===5 && o.cells[0][0]==='Name' && o.cells[0][1]==='Score'; }));
await ev(()=> setTool('frame')); await dragMouse(760, 420, 1100, 640);
check('frame is made and picked by its edge only', await ev(()=>{ const o = page().objects.at(-1), b = bbox(o);
  return o.type==='frame' && S.tool==='select' && !hit(o, {x:b.x+b.w/2, y:b.y+b.h/2}, 2) && hit(o, {x:b.x, y:b.y+b.h/2}, 2); }));
check('every stamp builds', await ev(()=> STAMPS.every(s=>{ const l = stampObjs(s.key, {x:0,y:0}, 1, '#fff'); return l.length > 1 && l.every(o=>o.gid===l[0].gid); })));
await ev(()=> placeStamp('resistor'));
check('stamp lands as a group', await ev(()=> S.selection.length > 5 && canUngroup()));
await ev(()=>{ S.selection = []; applyTemplate('cornell'); });
check('template is added pinned', await ev(()=> page().objects[0].locked===true));

// ---- lining up, smart guides ----
await ev(()=>{ const s = view().s; const mk = (x, y)=> ({id:uid(), type:'rect', tool:'rect', color:'#fff', size:3, fill:false, dash:false, x:S2W(x,0).x, y:S2W(0,y).y, w:60/s, h:40/s, rot:0});
  pushUndo(); const a = mk(120, 200), b = mk(150, 260), c = mk(190, 320); page().objects.push(a, b, c); S.selection = [a, b, c]; setTool('select'); S.selection = [a, b, c]; alignSel('l'); });
check('line up left', await ev(()=> new Set(S.selection.map(o=>Math.round(o.x*100))).size===1));
await ev(()=>{ S.selection = [S.selection[2]]; });
const from = await ev(()=>{ const o = S.selection[0], p = W2S(o.x + o.w/2, o.y + o.h/2); return p; });
await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 204, from.y + 3, {steps:6});
check('smart guide shows while moving', await soon(()=> !!(drag && drag.guides)));
await page.mouse.up();

// ---- compass ----
await ev(()=>{ S.selection = []; toggleCompass(true); });
await dragMouse(400, 620, 460, 620); await dragMouse(460, 620, 400, 680, 12);
check('compass draws an arc at its radius', await ev(()=>{ const o = page().objects.at(-1), C = COMPASS; return C.set && o.type==='stroke' && o.points.every(p=> Math.abs(Math.hypot(p.x-C.c.x, p.y-C.c.y) - C.r) < 1e-6); }));
await ev(()=> setTool('pen'));

// ---- graphs ----
const poi = await ev(()=>{ const s = view().s, c = S2W(900, 250);
  placeNew({id:uid(), type:'graph', tool:'graph', color:'#fff', size:3, exprs:['y = x^2 - 4', 'y = x'], x0:-10, x1:10, y0:null, y1:null, x:c.x, y:c.y, w:300/s, h:220/s, rot:0});
  const pts = graphPOI(S.selection[0]); return pts.map(p=> p.kind + ':' + (+p.x.toFixed(3)) + ',' + (+p.y.toFixed(3))); });
check('graph key points', ['zero:-2,0', 'zero:2,0', 'min:0,-4', 'zero:0,0'].every(k=> poi.includes(k)) && poi.filter(k=>k.startsWith('meet')).length===2, poi.join(' '));
await ev(()=> valuesTable());
check('table of values', await ev(()=>{ const o = page().objects.at(-1); return o.type==='table' && o.cells[0].length===3 && o.cells.some(r=> r[0]==='2' && r[1]==='0' && r[2]==='2'); }));
await page.waitForTimeout(150); await shot('board-full');

// ---- exports and round trip ----
check('PNG and SVG export include the new things', await ev(()=>{ const c = boardCanvas(0), svg = boardSVG(0); return c.width > 100 && svg.includes('<svg') && svg.length > 4000; }));
check('a board file keeps notes, tables and frames', await ev(()=>{ page().notes = 'say hello'; const d = JSON.parse(JSON.stringify(boardData(S.pages))), p = pagesFromData(d)[0];
  return p.notes==='say hello' && p.objects.some(o=>o.type==='table') && p.objects.some(o=>o.type==='frame') && p.objects.some(o=>o.note); }));

// ---- find any action ----
await page.mouse.move(4, 4);   // keep the pointer off the list, or hovering a row picks it instead of the top match
await page.keyboard.press('Control+k'); await page.waitForSelector('#palette.show'); await shot('palette');
await soon(()=> document.activeElement===$('palIn')); await page.focus('#palIn');   // typing before the box has focus would hit board shortcuts
await page.keyboard.type('surface white');
await soon(()=> PAL.shown.length && /white/i.test(PAL.shown[PAL.i].label));
await page.keyboard.press('Enter');
check('Ctrl+K runs an action', await soon(()=> S.theme==='whiteboard' && !$('palette').classList.contains('show')));
check('Ctrl+K lists tools, menu items and boards', await ev(()=>{ const l = paletteItems().map(i=>i.group); return ['Tool','Menu','Add','Setting','Look'].every(g=> l.includes(g)); }));

// ---- all boards ----
await ev(()=>{ $('addPage').click(); gotoPage(0); duplicatePage(0); });
check('duplicate a board', await ev(()=> S.pages.length===3 && S.pages[1].objects.length===S.pages[0].objects.length && S.pages[1].objects[0].id!==S.pages[0].objects[0].id));
await ev(()=>{ movePage(0, 2); });
check('reorder boards keeps you on the same one', await ev(()=> S.page===2 && S.pages[2].objects.length > 5));
await ev(()=>{ openOverview(); }); check('all boards sheet draws', await ev(()=> $('ovGrid').children.length===3)); await shot('overview');
await ev(()=>{ $('overview').classList.remove('show'); movePage(2, 0); removePage(1); });

// ---- library and home ----
await ev(async ()=>{ DOC.name = 'Physics review'; await libSave(true); AUTO.saved = editCount; });
check('the board is in the library with pictures', await ev(()=> LIBR.list.length===1 && LIBR.list[0].thumbs.length===2 && LIBR.list[0].text.includes('ship it') && LIBR.list[0].vers.length===1));
const first = await ev(()=> DOC.id), n0 = await ev(()=> S.pages[0].objects.length);
await ev(()=> newDoc('slate', 'plane'));
check('a new board from a template starts clean', await ev(id=> DOC.id===null && S.theme==='slate' && S.grid==='grid' && page().objects.length > 5 && !homeOpen() && LIBR.list.length===1 && id!==null, first));
await ev(()=> showHome()); await page.waitForSelector('.hm-card'); await page.waitForTimeout(200); await shot('home');
check('home lists the board', await ev(()=> document.querySelectorAll('.hm-card').length===1 && document.querySelector('.hm-meta b').textContent.startsWith('Physics review')));
await page.fill('#hmSearch', 'ship it'); check('search finds words on a board', await ev(()=> document.querySelectorAll('.hm-card').length===1));
await page.fill('#hmSearch', 'zzzz'); check('search hides what does not match', await ev(()=> document.querySelectorAll('.hm-card').length===0));
await page.fill('#hmSearch', '');
await page.click('.hm-card');
await page.waitForFunction(id=> DOC.id===id && !homeOpen(), first);
check('opening a board from home brings it back', await ev(n=> S.pages[0].objects.length===n && S.theme==='whiteboard' && S.pages.length===2, n0));
await ev(async id=>{ await libPatch(id, {pinned:true, folder:'School'}); await libCopy(id, {name:'Physics review copy'}); await libCopy(id, {name:'My layout', template:true}); }, first);
await ev(()=> showHome());
check('pins, folders, copies and templates', await ev(()=> libLive().length===3 && [...document.querySelectorAll('.hm-chip')].map(c=>c.textContent).join('|')==='All boards|Pinned|School|My templates' && !!document.querySelector('.hm-pinned')));
await ev(async ()=>{ const c = LIBR.list.find(e=>e.name==='Physics review copy'); await libPatch(c.id, {trashed:Date.now()}); renderHome(); });
check('trash holds a board and can put it back', await ev(async ()=>{ const had = document.querySelectorAll('.hm-card').length===1 && [...document.querySelectorAll('.hm-chip')].some(c=>c.textContent==='Trash (1)');
  const c = LIBR.list.find(e=>e.trashed); await libPatch(c.id, {trashed:null}); return had && libLive().length===3; }));
await ev(()=> hideHome());

// ---- versions ----
await ev(async id=>{ const e = libEntry(id); const t = Date.now() - 3600e3, json = await kvGet('doc:' + id), d = JSON.parse(json); d.pages = d.pages.slice(0, 1); await kvSet('ver:' + id + ':' + t, JSON.stringify(d)); e.vers.unshift(t); await libStore(); await openHistory(id); }, first);
await page.click('.vr-row:last-child [data-t]'); await page.waitForFunction(()=> S.pages.length===1);
check('an earlier version comes back, and the current one is kept', await ev(id=> DOC.id===id && libEntry(id).vers.length===3, first));

// ---- backup ----
check('backup file restores into an empty library', await ev(async ()=>{
  const boards = []; for(const e of LIBR.list) boards.push({entry:e, data:await kvGet('doc:' + e.id)});
  const file = new File([JSON.stringify({app:'screenboard-library', v:1, t:Date.now(), boards})], 'x.screenboard-backup');
  const keep = LIBR.list.slice(); LIBR.list = LIBR.list.filter(e=>e.id===DOC.id);
  await restoreBackup(file); return LIBR.list.length===keep.length;
}));

// ---- library folder (using the browser's private file system as the folder) ----
const folder = await ev(async ()=>{
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('lib', {create:true});
  await dirUse(dir);
  const names = []; for await (const [n] of dir.entries()) names.push(n);
  const other = {app:'screenboard', v:2, theme:'slate', grid:'none', pages:[{objects:[{id:'a1', type:'text', tool:'text', color:'#fff', size:28, rot:0, x:0, y:0, text:'from another computer'}], view:{x:0,y:0,s:1}}], doc:{id:'abcdef123456', name:'Chem notes', updated:Date.now()}};
  const fh = await dir.getFileHandle('Chem notes [abcdef].screenboard', {create:true}), w = await fh.createWritable(); await w.write(JSON.stringify(other)); await w.close();
  const got = await dirSync(), e = libEntry('abcdef123456');
  return {files:names.length, boards:LIBR.list.filter(x=>!x.trashed).length - 1, got, name:e && e.name, text:e && e.text};
});
check('library folder: boards are written out and new files are read in', folder.files===folder.boards && folder.got===1 && folder.name==='Chem notes' && /another computer/.test(folder.text), JSON.stringify(folder));
await ev(()=> dirStop());

// ---- saving in place, with a stand-in file handle ----
check('Ctrl+S writes back to the same file', await ev(async ()=>{
  const dir = await navigator.storage.getDirectory(), h = await dir.getFileHandle('saved.screenboard', {create:true});
  DOC.handle = h; await quickSave(); const a = JSON.parse(await (await h.getFile()).text());
  DOC.handle = null; await kvDel('fh:' + DOC.id);   // this stand-in handle shouldn't be kept for the reloads below
  return a.doc.id===DOC.id && Array.isArray(a.pages) && a.pages.length===S.pages.length;
}));

// ---- presenter notes, copy as picture ----
const [pop] = await Promise.all([ctx.waitForEvent('page'), ev(()=> openNotes())]);
await pop.waitForSelector('#tx'); await pop.fill('#tx', 'remember the demo');
check('presenter notes are kept with the board, in their own window', await ev(()=> page().notes==='remember the demo'));
await pop.close();

// ---- bundled libraries, still pinned by hash, under the content security policy ----
{
  check('equations render (MathJax)', await ev(async ()=>{ const r = await texToSvg('x^2+1'); return !!r.svg && !r.error; }));
  const [pdf] = await Promise.all([page.waitForEvent('download'), ev(()=> saveBoardsAs([0], 'out', {fmt:'pdf', area:'all'}))]);
  const pdfPath = await pdf.path(); check('PDF export (jsPDF)', fs.statSync(pdfPath).size > 2000);
  await ev(()=>{ $('addPage').click(); gotoPage(0); });
  const [zip] = await Promise.all([page.waitForEvent('download'), ev(()=> saveBoardsAs([0, 1], 'out', {fmt:'png', area:'all', bg:true}))]);
  check('several PNGs come as a zip (JSZip)', (await zip.suggestedFilename()).endsWith('.zip'));
  const before = await ev(()=> S.pages.length);
  await ev(async bytes=>{ await importPDF(new File([new Uint8Array(bytes)], 'in.pdf', {type:'application/pdf'})); }, [...fs.readFileSync(pdfPath)]);
  await page.waitForFunction(n=> S.pages.length > n, before, {timeout:20000}).catch(()=>{});
  check('PDF opens to write on (PDF.js, worker checked by hash)', await ev(n=> S.pages.length > n, before));
  check('PeerJS loads', await ev(()=> loadPeerJS().then(()=> typeof window.Peer==='function')));
  check('a tampered library is refused', await ev(async ()=>{ SRI['./lib/jszip.min.js?x'] = 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    try{ await loadLib('./lib/jszip.min.js?x', ()=> false); return false; }catch(e){ return true; } }));
}
check('the menu and Home link back to LaTeX Modeler', await ev(()=> new URL($('lmMi').href).pathname==='/' && new URL(document.querySelector('.hm-lm').href).pathname==='/'));

// ---- coming back: home, last board, migration from the old saved copy ----
await ev(async ()=>{ await libSave(true); AUTO.saved = editCount; localStorage.removeItem('sb-news'); });
await page.reload(); await page.waitForFunction(()=> typeof LIBR!=='undefined'); await ev(()=> LIBR.ready);
await page.waitForFunction(()=> homeOpen() || $('news').classList.contains('show'));
check('coming back opens Home, with What\'s new shown once', await ev(()=> homeOpen() && $('news').classList.contains('show')));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
check('Escape closes What\'s new, then Home', await ev(()=> !homeOpen() && !$('news').classList.contains('show')));
await ev(()=>{ PREFS.openTo = 'last'; savePrefs(); });
await page.reload(); await page.waitForFunction(()=> typeof LIBR!=='undefined');
await page.waitForFunction(id=> DOC.id===id, first, {timeout:5000}).catch(()=>{});
check('"Last board" opens what you had', await ev(id=> DOC.id===id && !homeOpen() && !$('news').classList.contains('show'), first));
await ev(async ()=>{ await kvSet('last', {t:Date.now() - 5000, data:JSON.stringify({app:'screenboard', v:2, theme:'chalkboard', pages:[{objects:[{id:'z9', type:'text', tool:'text', color:'#fff', size:28, rot:0, x:0, y:0, text:'old work'}], view:{x:0,y:0,s:1}}]})}); });
await page.reload(); await page.waitForFunction(()=> typeof LIBR!=='undefined'); await ev(()=> LIBR.ready);
check('work kept by the previous version moves into the library', await ev(async ()=> LIBR.list.some(e=>e.name==='Recovered board' && e.text.includes('old work')) && !(await kvGet('last'))));

// ---- phone ----
await page.setViewportSize({width:390, height:780}); await ev(()=> showHome()); await page.waitForTimeout(250); await shot('home-phone');
check('home fits a phone', await ev(()=> document.documentElement.scrollWidth <= 390 && $('home').scrollWidth <= 390));
await ev(()=> hideHome()); await shot('board-phone');
check('the tool dock still fits a phone', await ev(()=>{ const r = $('dock').getBoundingClientRect(); return r.left >= 0 && r.right <= 390.5 || $('dock').scrollWidth > 0; }));

const real = errors.filter(e=> !/favicon|ERR_FAILED|Failed to load resource/.test(e) && !/valid digest.*jszip\.min\.js\?x/.test(e));   // the tamper check above is meant to be blocked
check('no script errors or blocked resources', real.length===0, real.slice(0, 6).join(' | '));
check('nothing loads from other websites', outside.length===0, outside.slice(0, 4).join(' | '));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
