// Lightweight code editor: textarea over a syntax-highlighted layer, with a gutter,
// current/error line markers, auto-indent, Tab/Shift-Tab and comment toggling.
import { KEYWORDS } from '../lang/parser';
import { BUILTIN_NAMES } from '../lang/interp';

const LH = 20, PADT = 8;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src: string) {
  const re = /(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\"|[^"])*"?)|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(=>|==|!=|<=|>=|&&|\|\||\.\.|[+\-*/%^<>=!?:])|([()[\]{}])|(\s+|.)/g;
  let out = '', m: RegExpExecArray | null; const depthCls = ['p', 'k', 'v']; let depth = 0;
  while ((m = re.exec(src))) {
    if (m[1] || m[2]) out += `<span class="c">${esc(m[0])}</span>`;
    else if (m[3]) {
      const s = m[3]; const hex = /^"(#[0-9a-fA-F]{3,8})"$/.exec(s);
      const inner = esc(s).replace(/\\[A-Za-z]+|\\./g, x => `<span class="tx">${x}</span>`);
      out += hex ? `<span class="s sw" style="border-color:${hex[1]}">${inner}</span>` : `<span class="s">${inner}</span>`;
    }
    else if (m[4]) out += `<span class="n">${m[4]}</span>`;
    else if (m[5]) {
      const w = m[5]; const after = src.slice(re.lastIndex).match(/^\s*(\(|=>)/);
      if (KEYWORDS.has(w)) out += `<span class="k">${w}</span>`;
      else if (w === 'pi' || w === 'tau' || w === 't') out += `<span class="cn">${w}</span>`;
      else if (after && after[1] === '(') out += `<span class="${BUILTIN_NAMES.has(w) ? 'b' : 'f'}">${w}</span>`;
      else out += `<span class="v">${w}</span>`;
    }
    else if (m[6]) out += `<span class="o">${esc(m[6])}</span>`;
    else if (m[7]) {
      const ch = m[7];
      if ('([{'.includes(ch)) { out += `<span class="${depthCls[depth % 3]}">${ch}</span>`; depth++; }
      else { depth = Math.max(0, depth - 1); out += `<span class="${depthCls[depth % 3]}">${ch}</span>`; }
    }
    else out += esc(m[0]);
  }
  return out + '\n ';
}

export class Editor {
  ta: HTMLTextAreaElement; hl: HTMLElement; layers: HTMLElement; gutter: HTMLElement;
  cur: HTMLElement; err: HTMLElement; flash: HTMLElement;
  errLine = 0; onChange: () => void = () => {}; onRun: () => void = () => {}; onCursor: (l: number, c: number) => void = () => {};

  constructor(root: HTMLElement) {
    root.innerHTML = `<div class="gutter"><div class="gutterIn"></div></div>
      <div class="codewrap"><div class="layers"><div class="lnhl curline"></div><div class="lnhl errline"></div><div class="lnhl flashline"></div><pre class="hl"></pre></div>
      <textarea spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="code editor"></textarea></div>`;
    this.ta = root.querySelector('textarea')!; this.hl = root.querySelector('.hl')!; this.layers = root.querySelector('.layers')!;
    this.gutter = root.querySelector('.gutterIn')!; this.cur = root.querySelector('.curline')!; this.err = root.querySelector('.errline')!; this.flash = root.querySelector('.flashline')!;
    this.ta.addEventListener('scroll', () => this.sync());
    ['keyup', 'click', 'select'].forEach(ev => this.ta.addEventListener(ev, () => this.marks()));
    document.addEventListener('selectionchange', () => { if (document.activeElement === this.ta) this.marks(); });
    this.ta.addEventListener('input', () => { this.refresh(); this.onChange(); });
    this.ta.addEventListener('keydown', e => this.keys(e));
  }
  get value() { return this.ta.value; }
  set value(v: string) { this.ta.value = v; this.ta.scrollTop = 0; this.ta.scrollLeft = 0; this.ta.setSelectionRange(0, 0); this.refresh(); }
  refresh() {
    this.hl.innerHTML = highlight(this.ta.value);
    const n = this.ta.value.split('\n').length; let g = '';
    for (let i = 1; i <= n; i++) g += `<div>${i}</div>`;
    this.gutter.innerHTML = g;
    this.layers.style.width = Math.max(this.hl.scrollWidth, this.ta.clientWidth) + 'px';
    this.marks(); this.sync();
  }
  caretLine() { return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length; }
  marks() {
    const cl = this.caretLine();
    this.gutter.querySelectorAll('.cur,.bad').forEach(d => d.classList.remove('cur', 'bad'));
    this.gutter.children[cl - 1]?.classList.add('cur');
    this.cur.style.top = (PADT + (cl - 1) * LH) + 'px';
    if (this.errLine) { this.gutter.children[this.errLine - 1]?.classList.add('bad'); this.err.style.display = 'block'; this.err.style.top = (PADT + (this.errLine - 1) * LH) + 'px'; }
    else this.err.style.display = 'none';
    const col = this.ta.selectionStart - this.ta.value.lastIndexOf('\n', this.ta.selectionStart - 1);
    this.onCursor(cl, col);
  }
  setError(line: number) { this.errLine = line; this.marks(); }
  sync() { this.layers.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`; this.gutter.style.transform = `translateY(${-this.ta.scrollTop}px)`; }
  goTo(l: number, flash = true) {
    const lines = this.ta.value.split('\n'); l = Math.max(1, Math.min(lines.length, l));
    let pos = 0; for (let i = 0; i < l - 1; i++) pos += lines[i].length + 1;
    const indent = (lines[l - 1].match(/^\s*/) || [''])[0].length;
    this.ta.focus({ preventScroll: true }); this.ta.setSelectionRange(pos + indent, pos + lines[l - 1].length);
    const y = PADT + (l - 1) * LH; if (y < this.ta.scrollTop + 20 || y > this.ta.scrollTop + this.ta.clientHeight - 40) this.ta.scrollTop = y - this.ta.clientHeight / 3;
    this.sync(); this.marks();
    if (flash) { this.flash.style.top = y + 'px'; this.flash.style.transition = 'none'; this.flash.style.opacity = '1'; requestAnimationFrame(() => { this.flash.style.transition = 'opacity 1.2s'; this.flash.style.opacity = '0'; }); }
  }
  private insert(text: string) { if (!document.execCommand('insertText', false, text)) this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, 'end'); }
  private keys(e: KeyboardEvent) {
    const ta = this.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.onRun(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', en - (en > s && v[en - 1] === '\n' ? 1 : 0)); if (le < 0) le = v.length;
      const block = v.slice(ls, le).split('\n'); const allC = block.every(l => /^\s*\/\//.test(l) || !l.trim());
      const out = block.map(l => (!l.trim() ? l : allC ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.replace(/^(\s*)/, '$1// '))).join('\n');
      ta.setSelectionRange(ls, le); this.insert(out); ta.setSelectionRange(ls, ls + out.length); return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s !== en || e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', en - 1); if (le < 0) le = v.length;
        const block = v.slice(ls, le).split('\n').map(l => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
        ta.setSelectionRange(ls, le); this.insert(block); ta.setSelectionRange(ls, ls + block.length);
      } else this.insert('  ');
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1; const cur = v.slice(ls, s);
      let ind = (cur.match(/^\s*/) || [''])[0]; if (/[{([]\s*$/.test(cur)) ind += '  ';
      this.insert('\n' + ind); return;
    }
    if ((e.key === '}' || e.key === ')' || e.key === ']') && s === en) {
      const ls = v.lastIndexOf('\n', s - 1) + 1; const cur = v.slice(ls, s);
      if (/^\s+$/.test(cur)) { e.preventDefault(); ta.setSelectionRange(Math.max(ls, s - 2), s); this.insert(e.key); }
    }
  }
}
