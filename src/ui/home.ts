// The start screen: templates to begin a page, the example library by folder, an equation box,
// and the pages already open.
import { TEMPLATES, EXAMPLES, FOLDERS, SIZE_CHOICES, blankPage, type LibItem } from '../library';
import { PAGE_STYLES, STAGES } from '../lang/pages';
import type { Thumbs } from './thumbs';
import { BOARD_URL, BOARD_THEMES, recentBoards, ago, boardSketch } from './boards';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HomeHost {
  thumbs: Thumbs;
  /** pages currently open as tabs */
  openDocs(): { id: string; name: string; text: string; dirty: boolean; where: string }[];
  resume(id: string): void;
  create(name: string, src: string): void;
  openExample(item: LibItem): void;
  model(tex: string): void;
  openFile(): void;
  importTikz(): void;
  openBoard(query: string, name?: string): void;
  write(): void;
  quickEquations: { label: string; tex: string }[];
}

export class Home {
  el: HTMLElement; private folder = 'all'; private query = '';
  private io: IntersectionObserver;
  constructor(parent: HTMLElement, private host: HomeHost) {
    this.el = document.createElement('div'); this.el.id = 'home'; parent.appendChild(this.el);
    // pictures render only once their card scrolls into view
    this.io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { this.io.unobserve(e.target); this.paint(e.target as HTMLElement); } }, { root: this.el, rootMargin: '300px' });
    this.build();
  }

  private build() {
    const sizes = SIZE_CHOICES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const styles = Object.entries(PAGE_STYLES).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('');
    const stages = Object.entries(STAGES).map(([k, s]) => `<option value="${k}" title="${esc(s.about)}">${esc(s.label)}</option>`).join('');
    this.el.innerHTML = `<div class="hin">
      <div class="hero">
        <h1>What are you making today?</h1>
        <p>Start from a template, open an example, or type an equation and LaTeX Modeler builds the page for you.</p>
        <div class="heq"><span class="sig">∑</span><input id="hEq" spellcheck="false" autocomplete="off" placeholder="type LaTeX, e.g.  z = \\sin\\sqrt{x^2+y^2}  and press Enter"><button class="vbtn" id="hWrite" title="Write the equation by hand">✎ Write</button><button class="vbtn primary" id="hGo">Model it</button></div>
        <div class="hchips"><span class="lead">try:</span>${this.host.quickEquations.map((q, i) => `<button class="chip" data-q="${i}" title="${esc(q.tex)}">${esc(q.label)}</button>`).join('')}
          <span class="lead" style="margin-left:auto">have a .bd file? <button class="hlink" id="hFile">Open it…</button> · <button class="hlink" id="hTikz" title="Paste TikZ or pgfplots code and get an editable 3D page">Import TikZ…</button></span></div>
      </div>
      <section id="hOpen"></section>
      <section>
        <div class="shead"><h2>New page</h2><span>pick a template — every one is plain code you can change</span></div>
        <div class="grid" id="hTpl"></div>
      </section>
      <section id="hBoards">
        <div class="shead"><h2>Boards</h2><span>draw freehand on a chalkboard or whiteboard, great for explaining things on a call</span><a class="vbtn" id="hAllBoards" href="${BOARD_URL}?do=home">All boards</a></div>
        <div class="grid" id="hBoardGrid"></div>
      </section>
      <section>
        <div class="shead"><h2>Examples</h2><span>what LaTeX Modeler can do — open one, orbit it, change it</span>
          <input id="hFind" type="search" placeholder="Search examples" spellcheck="false"></div>
        <div class="folders" id="hFolders"><button class="chip on" data-f="all">All</button>${FOLDERS.map(([k, l]) => `<button class="chip" data-f="${k}">${esc(l)} <small>${EXAMPLES.filter(e => e.folder === k).length}</small></button>`).join('')}</div>
        <div id="hEx"></div>
      </section>
      <p class="hfoot">Tip: the page under every card is real 3D — drag it to orbit, and click anything on it to jump to its code.</p>
    </div>`;
    // templates + one "blank page in any format" card
    const tpl = this.el.querySelector('#hTpl')!;
    for (const t of TEMPLATES) tpl.appendChild(this.card(t.title, t.about, t.format, t.src, () => this.host.create(t.file === 'blank.bd' ? 'untitled.bd' : t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.bd', t.src)));
    const blank = document.createElement('div'); blank.className = 'card custom';
    blank.innerHTML = `<div class="th"></div><div class="meta"><div class="t">Blank page, your format</div>
      <div class="opts"><label>Size<select data-o="size">${sizes}</select></label><label>Paper<select data-o="style">${styles}</select></label><label>Stage<select data-o="stage">${stages}</select></label></div>
      <button class="vbtn primary">Create</button></div>`;
    const sel = (k: string) => blank.querySelector<HTMLSelectElement>(`[data-o="${k}"]`)!;
    const cur = () => blankPage(sel('size').value, sel('style').value, sel('stage').value);
    const repaint = () => { const th = blank.querySelector<HTMLElement>('.th')!; th.dataset.src = cur(); this.paint(th.parentElement!); };
    blank.querySelectorAll('select').forEach(s => s.addEventListener('change', repaint));
    blank.querySelector('button')!.onclick = () => this.host.create('untitled.bd', cur());
    blank.querySelector<HTMLElement>('.th')!.onclick = () => this.host.create('untitled.bd', cur());
    tpl.appendChild(blank);
    (blank.querySelector('.th') as HTMLElement).dataset.src = cur(); this.io.observe(blank);
    // equation box
    const eq = this.el.querySelector<HTMLInputElement>('#hEq')!;
    const go = () => { const v = eq.value.trim(); if (!v) { eq.focus(); return; } this.host.model(v); };
    eq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    this.el.querySelector<HTMLElement>('#hGo')!.onclick = go;
    this.el.querySelector<HTMLElement>('#hFile')!.onclick = () => this.host.openFile();
    this.el.querySelector<HTMLElement>('#hTikz')!.onclick = () => this.host.importTikz();
    this.el.querySelector<HTMLElement>('#hAllBoards')!.onclick = e => { if (e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); this.host.openBoard('?do=home', 'All boards'); };
    this.el.querySelector<HTMLElement>('#hWrite')!.onclick = () => this.host.write();
    this.el.querySelectorAll<HTMLElement>('.hchips .chip').forEach(b => b.onclick = () => { const q = this.host.quickEquations[+b.dataset.q!]; eq.value = q.tex; this.host.model(q.tex); });
    // example filters
    this.el.querySelectorAll<HTMLElement>('#hFolders .chip').forEach(b => b.onclick = () => {
      this.folder = b.dataset.f!; this.el.querySelectorAll('#hFolders .chip').forEach(x => x.classList.toggle('on', x === b)); this.renderExamples();
    });
    const find = this.el.querySelector<HTMLInputElement>('#hFind')!;
    find.addEventListener('input', () => { this.query = find.value.trim().toLowerCase(); this.renderExamples(); });
    this.renderExamples();
    this.renderBoards([]);
  }

  /** new-board cards for each surface, then the boards you worked on last */
  private renderBoards(recent: Awaited<ReturnType<typeof recentBoards>>) {
    const g = this.el.querySelector('#hBoardGrid'); if (!g) return;
    g.innerHTML = '';
    const link = (href: string, th: string, title: string, about: string, foot: string) => {
      const a = document.createElement('a'); a.className = 'card board'; a.href = href;
      // boards open as tabs here; Ctrl/Cmd-click still opens one in its own browser tab
      a.onclick = e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); this.host.openBoard(href.slice(href.indexOf('?')), title); };
      a.innerHTML = `<div class="th">${th}</div><div class="meta"><div class="t">${esc(title)}</div><div class="d">${esc(about)}</div><div class="f">${esc(foot)}</div></div>`;
      g.appendChild(a); return a;
    };
    for (const t of BOARD_THEMES) link(`${BOARD_URL}?new=${t.key}`, boardSketch(t), `New ${t.label.toLowerCase()}`, t.about, 'Board');
    for (const b of recent) {
      const a = link(`${BOARD_URL}?open=${encodeURIComponent(b.id)}`, '', b.name, `${b.pages} ${b.pages === 1 ? 'board' : 'boards'} · ${ago(b.updated)}`, 'Board');
      const th = a.querySelector<HTMLElement>('.th')!;
      if (b.thumb) { const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.src = b.thumb; th.appendChild(img); }
      else th.classList.add('blank');
    }
  }

  private card(title: string, about: string, format: string, src: string, open: () => void, extra = '') {
    const c = document.createElement('div'); c.className = 'card'; c.tabIndex = 0;
    c.innerHTML = `<div class="th" data-src=""></div><div class="meta"><div class="t">${esc(title)}${extra}</div><div class="d">${esc(about)}</div><div class="f">${esc(format)}</div></div>`;
    (c.querySelector('.th') as HTMLElement).dataset.src = src;
    c.onclick = open; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    const hit = this.host.thumbs.cached(src); if (hit) this.setPic(c, hit); else this.io.observe(c);
    return c;
  }
  private paint(card: HTMLElement) {
    const th = card.querySelector<HTMLElement>('.th'); const src = th?.dataset.src; if (!th || !src) return;
    th.classList.add('loading');
    this.host.thumbs.get(src).then(url => { if (th.dataset.src !== src) return; th.classList.remove('loading'); if (url) this.setPic(card, url); else th.classList.add('broken'); });
  }
  private setPic(card: HTMLElement, url: string) {
    const th = card.querySelector<HTMLElement>('.th')!; th.classList.remove('loading');
    let img = th.querySelector('img'); if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; th.appendChild(img); }
    img.src = url;
  }

  private renderExamples() {
    const box = this.el.querySelector('#hEx')!; box.innerHTML = '';
    const q = this.query;
    const match = (e: LibItem) => (this.folder === 'all' || e.folder === this.folder) && (!q || (e.title + ' ' + e.about + ' ' + e.folder).toLowerCase().includes(q));
    const groups = FOLDERS.filter(([k]) => this.folder === 'all' || k === this.folder);
    let any = false;
    for (const [k, label] of groups) {
      const items = EXAMPLES.filter(e => e.folder === k && match(e)); if (!items.length) continue; any = true;
      const sec = document.createElement('div'); sec.className = 'exgroup';
      sec.innerHTML = `<h3>${esc(label)}</h3><div class="grid"></div>`;
      const g = sec.querySelector('.grid')!;
      for (const e of items) g.appendChild(this.card(e.title, e.about, e.format, e.src, () => this.host.openExample(e)));
      box.appendChild(sec);
    }
    if (!any) box.innerHTML = `<p class="none">No examples match “${esc(this.query)}”.</p>`;
  }

  /** the "continue" row: pages that are already open */
  refresh() {
    recentBoards(5).then(list => this.renderBoards(list));
    const sec = this.el.querySelector('#hOpen')!; const docs = this.host.openDocs();
    if (!docs.length) { sec.innerHTML = ''; return; }
    sec.innerHTML = `<div class="shead"><h2>Continue</h2><span>${docs.length === 1 ? 'the page you have open' : `the ${docs.length} pages you have open`}</span></div><div class="grid"></div>`;
    const g = sec.querySelector('.grid')!;
    for (const d of docs) g.appendChild(this.card(d.name, d.where, d.dirty ? 'unsaved changes' : '', d.text, () => this.host.resume(d.id), d.dirty ? ' <span class="dot">●</span>' : ''));
  }
  focusEquation() { this.el.querySelector<HTMLInputElement>('#hEq')?.focus(); }
  scrollToTemplates() { this.el.querySelector('#hTpl')?.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
