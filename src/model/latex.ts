// LaTeX math → expression tree. Accepts the notation people actually type:
// implicit multiplication (2x, xy, 2\pi r), \sin^2 x, \sin 2x, \frac / \dfrac, \sqrt[n]{}, |x|,
// \left( \right), matrices, cases, finite sums/products, ±, y' and dy/dx, domain clauses, Unicode symbols.
import { Node, N, S, PI, E, add, mul, pow, fn, neg, MathError } from './sym';

type Tok = { t: string; v: string };

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'rho', 'varrho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega', 'ell', 'hbar'];
const GREEK_CANON: Record<string, string> = { varepsilon: 'epsilon', vartheta: 'theta', varrho: 'rho', varphi: 'phi' };
const FUNCS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cosec: 'csc', cot: 'cot', cotan: 'cot',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccot: 'acot', arcsec: 'asec', arccsc: 'acsc', asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', coth: 'coth', sech: 'sech', csch: 'csch',
  arsinh: 'asinh', arcsinh: 'asinh', asinh: 'asinh', arcosh: 'acosh', arccosh: 'acosh', acosh: 'acosh', artanh: 'atanh', arctanh: 'atanh', atanh: 'atanh',
  exp: 'exp', ln: 'ln', log: 'ln', lg: 'log10', sgn: 'sign', sign: 'sign', signum: 'sign', erf: 'erf', max: 'max', min: 'min', det: 'det',
  sinc: 'sinc', floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs', sqrt: 'sqrt', cbrt: 'cbrt', atan2: 'atan2', Gamma: 'gamma', gamma: 'gamma',
};
const WORD_FUNCS = new Set(Object.keys(FUNCS).filter(k => !['Gamma', 'gamma'].includes(k)));
const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sec: 'asec', csc: 'acsc', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
const SKIP_CMDS = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr',
  'quad', 'qquad', 'mathrm', 'mathit', 'boldmath', 'nonumber', 'notag', 'label', 'tag', 'cdotp', 'mathstrut', 'strut', 'phantom', 'hphantom', 'vphantom']);
const REL_CMDS: Record<string, string> = { le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', lt: '<', gt: '>', ne: '!=', neq: '!=', approx: '=', equiv: '=', simeq: '=', coloneqq: '=', eqqcolon: '=', in: 'in', to: '=' };
const UNICODE: [RegExp, string][] = [
  [/−|–/g, '-'], [/·|⋅|∙/g, '\\cdot '], [/×/g, '\\times '], [/÷/g, '\\div '], [/≤/g, '\\le '], [/≥/g, '\\ge '], [/≠/g, '\\ne '], [/≈/g, '\\approx '], [/∈/g, '\\in '],
  [/π/g, '\\pi '], [/θ/g, '\\theta '], [/φ|ϕ/g, '\\phi '], [/α/g, '\\alpha '], [/β/g, '\\beta '], [/γ/g, '\\gamma '], [/δ/g, '\\delta '], [/λ/g, '\\lambda '],
  [/μ/g, '\\mu '], [/ω/g, '\\omega '], [/ρ/g, '\\rho '], [/σ/g, '\\sigma '], [/τ/g, '\\tau '], [/ε/g, '\\epsilon '],
  [/²/g, '^2'], [/³/g, '^3'], [/√/g, '\\sqrt '], [/∞/g, '\\infty '], [/±/g, '\\pm '], [/∓/g, '\\mp '], [/∑/g, '\\sum '], [/∏/g, '\\prod '],
];

export function tokenize(input: string): Tok[] {
  let src = input.trim();
  for (const [re, r] of UNICODE) src = src.replace(re, r);
  src = src.replace(/^\$+|\$+$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '');
  src = src.replace(/\\(begin|end)\{(equation|equation\*|displaymath|math)\}/g, '');
  src = src.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');       // 1,000 → 1000
  src = src.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/!=/g, '\\ne ');
  const toks: Tok[] = []; let i = 0;
  const readGroup = () => {                        // raw text of a {...} group
    while (src[i] === ' ') i++;
    if (src[i] !== '{') { const c = src[i] ?? ''; i++; return c; }
    let d = 0, s = ''; i++;
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { if (d === 0) { i++; break; } d--; } s += src[i]; }
    return s;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)\*?/.exec(src.slice(i));
      if (m) {
        const name = m[1]; i += m[0].length;
        if (name === 'left' || name === 'right') { while (src[i] === ' ') i++; if (src[i] === '.') i++; continue; }
        if (SKIP_CMDS.has(name)) {
          if (name === 'quad' || name === 'qquad') toks.push({ t: 'sep', v: name });
          if (['mathrm', 'mathit'].includes(name)) { const g = readGroup(); pushWord(g); }
          if (['label', 'tag', 'phantom', 'hphantom', 'vphantom'].includes(name)) readGroup();
          continue;
        }
        if (['text', 'textrm', 'textit', 'mbox', 'operatorname', 'textnormal', 'textbf', 'mathsf', 'mathtt'].includes(name)) { pushWord(readGroup()); continue; }
        if (name === 'begin' || name === 'end') {
          const env = readGroup().replace(/\*$/, '');
          toks.push({ t: name, v: env });
          if (name === 'begin' && env === 'array') readGroup();
          continue;
        }
        if (name === 'lvert' || name === 'rvert' || name === 'vert' || name === 'mid') { toks.push({ t: 'bar', v: '|' }); continue; }
        if (name === 'lVert' || name === 'rVert' || name === 'Vert') { toks.push({ t: 'bar', v: '‖' }); continue; }
        if (name === 'langle' || name === 'lbrace') { toks.push({ t: 'open', v: '(' }); continue; }
        if (name === 'rangle' || name === 'rbrace') { toks.push({ t: 'close', v: ')' }); continue; }
        if (name === 'lbrack') { toks.push({ t: 'open', v: '[' }); continue; }
        if (name === 'rbrack') { toks.push({ t: 'close', v: ']' }); continue; }
        if (name === 'lfloor' || name === 'lceil') { toks.push({ t: 'open', v: name === 'lfloor' ? '⌊' : '⌈' }); continue; }
        if (name === 'rfloor' || name === 'rceil') { toks.push({ t: 'close', v: name === 'rfloor' ? '⌋' : '⌉' }); continue; }
        if (REL_CMDS[name]) { toks.push({ t: 'rel', v: REL_CMDS[name] }); continue; }
        toks.push({ t: 'cmd', v: name }); continue;
      }
      const n = src[i + 1];
      i += 2;
      if (n === '\\') toks.push({ t: 'row', v: '\\\\' });
      else if (n === '{') toks.push({ t: 'open', v: '(' });
      else if (n === '}') toks.push({ t: 'close', v: ')' });
      else if (n === '|') toks.push({ t: 'bar', v: '‖' });
      else if (n === '%' || n === '$' || n === '#' || n === '&') continue;
      continue;                                         // \, \; \: \! \  spacing
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z]/.test(c)) { toks.push({ t: 'id', v: c }); i++; continue; }
    if (c === '{' || c === '(' || c === '[') { toks.push({ t: 'open', v: c }); i++; continue; }
    if (c === '}' || c === ')' || c === ']') { toks.push({ t: 'close', v: c }); i++; continue; }
    if (c === '|') { toks.push({ t: 'bar', v: '|' }); i++; continue; }
    if (c === '&') { toks.push({ t: 'amp', v: '&' }); i++; continue; }
    if (c === '=' || c === '<' || c === '>') { toks.push({ t: 'rel', v: c }); i++; continue; }
    if (c === ':' && src[i + 1] === '=') { toks.push({ t: 'rel', v: '=' }); i += 2; continue; }
    if ('+-*/^_,;\'!:'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new MathError(`unexpected character “${c}”`);
  }
  toks.push({ t: 'eof', v: '' });
  return toks;

  function pushWord(raw: string) {
    const w = raw.trim();
    if (!w) return;
    if (/^(and|or|for|if|where|with|when|otherwise|else|then)$/i.test(w)) { toks.push({ t: 'word', v: w.toLowerCase() }); return; }
    if (/^,$/.test(w)) { toks.push({ t: 'op', v: ',' }); return; }
    if (WORD_FUNCS.has(w)) { toks.push({ t: 'cmd', v: w }); return; }
    if (/^[A-Za-z]$/.test(w)) { toks.push({ t: 'id', v: w }); return; }
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(w)) { toks.push({ t: 'word', v: w }); return; }
    if (/^\d+(\.\d+)?$/.test(w)) { toks.push({ t: 'num', v: w }); return; }
    // anything else (punctuation, prose) is ignored
  }
}

/** Parse LaTeX into a list of statements (equations, expressions, domain clauses). */
export function parseLatex(src: string): Node[] {
  const p = new LP(tokenize(src));
  const out = p.statements();
  return out;
}

class LP {
  i = 0; absDepth = 0; normDepth = 0;
  constructor(public t: Tok[]) {}
  peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
  next() { return this.t[this.i++]; }
  is(t: string, v?: string) { const k = this.peek(); return k.t === t && (v === undefined || k.v === v); }
  expectClose(...v: string[]) {
    const k = this.peek();
    if (k.t === 'close' && (v.length === 0 || v.includes(k.v))) { this.i++; return; }
    throw new MathError(k.t === 'eof' ? `missing “${v[0] ?? ')'}”` : `expected “${v[0] ?? ')'}” but found “${k.v}”`);
  }
  err(msg: string): never { throw new MathError(msg); }

  statements(): Node[] {
    const out: Node[] = [];
    for (;;) {
      while (this.is('sep') || this.is('op', ',') || this.is('op', ';') || this.is('row') || this.is('word') || this.is('amp')) this.i++;
      if (this.is('eof')) break;
      const s = this.relation();
      if (s.k === 'stmts') out.push(...s.a); else out.push(s);
      if (!(this.is('eof') || this.is('sep') || this.is('op', ',') || this.is('op', ';') || this.is('row') || this.is('word'))) {
        const k = this.peek(); this.err(`unexpected “${k.v}”`);
      }
    }
    if (!out.length) this.err('nothing to model — type an equation or expression');
    return out;
  }
  relation(): Node {
    const first = this.expr();
    const ops: string[] = [], terms: Node[] = [first];
    while (this.is('rel')) {
      let op = this.next().v;
      if ((op === '<' || op === '>') && this.is('rel', '=')) { this.next(); op += '='; }
      ops.push(op);
      if (op === 'in') terms.push(this.interval());
      else terms.push(this.expr());
    }
    return ops.length ? { k: 'rel', ops, terms } : first;
  }
  interval(): Node {
    if (this.is('cmd', 'mathbb')) { this.next(); this.scriptArg(); return { k: 'interval', lo: N(-Infinity), hi: N(Infinity) }; }
    if (this.is('id') && /^[RNZQC]$/.test(this.peek().v)) { this.next(); return { k: 'interval', lo: N(-Infinity), hi: N(Infinity) }; }
    if (!this.is('open', '[') && !this.is('open', '(')) this.err('expected an interval like [a, b] after \\in');
    this.next(); const lo = this.expr();
    if (!this.is('op', ',')) this.err('an interval needs two ends, like [0, 2\\pi]');
    this.next(); const hi = this.expr(); this.expectClose(']', ')');
    return { k: 'interval', lo, hi };
  }
  /** expression with + − ± */
  expr(): Node {
    const terms: Node[][] = [[]];             // alternatives (for ±)
    let sign = 1; let pm = 0;
    if (this.is('op', '-')) { this.next(); sign = -1; }
    else if (this.is('op', '+')) this.next();
    else if (this.is('cmd', 'pm') || this.is('cmd', 'mp')) { pm = this.next().v === 'pm' ? 1 : -1; }
    const pushTerm = (tm: Node) => {
      if (pm) {
        const out: Node[][] = [];
        for (const alt of terms) { out.push([...alt, pm > 0 ? tm : neg(tm)]); out.push([...alt, pm > 0 ? neg(tm) : tm]); }
        terms.length = 0; terms.push(...out.slice(0, 8));
      } else for (const alt of terms) alt.push(sign < 0 ? neg(tm) : tm);
    };
    pushTerm(this.term());
    for (;;) {
      sign = 1; pm = 0;
      if (this.is('op', '+')) this.next();
      else if (this.is('op', '-')) { this.next(); sign = -1; }
      else if (this.is('cmd', 'pm')) { this.next(); pm = 1; }
      else if (this.is('cmd', 'mp')) { this.next(); pm = -1; }
      else break;
      pushTerm(this.term());
    }
    const mk = (a: Node[]) => (a.length === 1 ? a[0] : add(...a));
    return terms.length === 1 ? mk(terms[0]) : { k: 'alt', a: terms.map(mk) };
  }
  startsFactor(): boolean {
    const k = this.peek();
    if (k.t === 'num' || k.t === 'id' || k.t === 'word') return true;
    if (k.t === 'open') return true;
    if (k.t === 'bar') return k.v === '|' ? this.absDepth === 0 : this.normDepth === 0;
    if (k.t === 'cmd') return !['cdot', 'times', 'div', 'ast', 'pm', 'mp', 'circ', 'prime'].includes(k.v);
    if (k.t === 'begin') return true;
    return false;
  }
  term(stopAtFn = false): Node {
    const fs: Node[] = [this.factor()];
    for (;;) {
      if (this.is('op', '*') || this.is('cmd', 'cdot') || this.is('cmd', 'times') || this.is('cmd', 'ast')) { this.next(); fs.push(this.factor()); }
      else if (this.is('op', '/') || this.is('cmd', 'div')) { this.next(); fs.push(pow(this.factor(), -1)); }
      else if (this.startsFactor()) {
        if (stopAtFn && this.is('cmd') && FUNCS[this.peek().v] && this.peek().v !== 'Gamma') break;
        fs.push(this.factor());
      }
      else break;
    }
    return fs.length === 1 ? fs[0] : mul(...fs);
  }
  factor(): Node {
    if (this.is('op', '-')) { this.next(); return neg(this.factor()); }
    if (this.is('op', '+')) { this.next(); return this.factor(); }
    let b = this.primary();
    for (;;) {
      if (this.is('op', '^')) {
        this.next();
        if (this.is('cmd', 'circ')) { this.next(); b = mul(b, PI, N(1 / 180)); continue; }
        if (this.is('open', '{') && this.peek(1).t === 'cmd' && this.peek(1).v === 'circ' && this.peek(2).t === 'close') { this.i += 3; b = mul(b, PI, N(1 / 180)); continue; }
        b = pow(b, this.scriptArg());
      } else if (this.is('op', '!')) { this.next(); b = fn('fact', b); }
      else if (this.is('op', "'")) {
        let order = 0; while (this.is('op', "'")) { this.next(); order++; }
        if (b.k !== 'sym') this.err('primes (′) are only supported on a single letter, like y′');
        b = { k: 'deriv', of: b.n, ofTex: b.tex, wrt: 'x', order };
        if (this.is('open', '(') && this.peek(1).t === 'id' && this.peek(2).t === 'close') { const w = this.peek(1).v; this.i += 3; (b as any).wrt = w; }
      } else if (this.is('op', '_')) { this.next(); this.scriptArg(); }   // stray subscript: ignore
      else break;
    }
    return b;
  }
  /** argument of ^ or _ : a {group} or a single token (LaTeX x^23 means x^2·3) */
  scriptArg(): Node {
    const k = this.peek();
    if (k.t === 'open' && k.v === '{') { this.next(); const e = this.relationOrExpr(); this.expectClose('}'); return e; }
    if (k.t === 'num') {
      if (k.v.length > 1 && !k.v.includes('.')) { this.t[this.i] = { t: 'num', v: k.v.slice(1) }; return N(+k.v[0]); }
      this.next(); return N(+k.v);
    }
    if (k.t === 'op' && k.v === '-') { this.next(); return neg(this.scriptArg()); }
    if (k.t === 'id') { this.next(); return this.symbol(k.v, k.v); }
    if (k.t === 'cmd') return this.primary();
    this.err('expected an exponent');
  }
  relationOrExpr(): Node { const e = this.expr(); if (this.is('rel')) { const op = this.next().v; return { k: 'rel', ops: [op], terms: [e, this.expr()] }; } return e; }
  subscriptText(): { name: string; tex: string } | null {
    if (!this.is('op', '_')) return null;
    this.next();
    const k = this.peek();
    if (k.t === 'open' && k.v === '{') {
      this.next(); let name = '', tex = '';
      let depth = 0;
      while (!(this.is('close') && depth === 0) && !this.is('eof')) {
        const q = this.next();
        if (q.t === 'open') depth++; if (q.t === 'close') depth--;
        if (q.t === 'cmd') { name += q.v; tex += `\\${q.v} `; }
        else if (q.t === 'word') { name += q.v; tex += `\\text{${q.v}}`; }
        else { name += /[A-Za-z0-9]/.test(q.v) ? q.v : ''; tex += q.v; }
      }
      this.expectClose('}');
      return { name: name || 's', tex: tex.trim() };
    }
    const q = this.next();
    if (q.t === 'num') {
      if (q.v.length > 1 && !q.v.includes('.')) { this.i--; this.t[this.i] = { t: 'num', v: q.v.slice(1) }; return { name: q.v[0], tex: q.v[0] }; }
      return { name: q.v, tex: q.v };
    }
    if (q.t === 'cmd') return { name: q.v, tex: `\\${q.v}` };
    return { name: q.v, tex: q.v };
  }
  symbol(name: string, tex: string): Node {
    const sub = this.subscriptText();
    if (sub) return S(`${name}_${sub.name}`, `${tex}_{${sub.tex}}`);
    if (name === 'e') return E;
    return S(name, tex);
  }
  group(closers: string[]): Node {
    // after an opening ( or [ : items separated by commas
    const items: Node[] = []; let trailing = false;
    while (!(this.is('close') && closers.includes(this.peek().v))) {
      if (this.is('eof')) this.err(`missing “${closers[0]}”`);
      if (this.is('sep')) { this.next(); continue; }
      items.push(this.relationOrExpr()); trailing = false;
      if (this.is('op', ',') || this.is('op', ';')) { this.next(); trailing = true; }
      else if (!(this.is('close') && closers.includes(this.peek().v))) this.err(`expected “,” or “${closers[0]}” but found “${this.peek().v}”`);
    }
    this.next();
    if (items.length === 0) this.err('empty parentheses');
    if (items.length === 1 && !trailing) { const x = { ...items[0], paren: true } as Node; return x; }
    return { k: 'tuple', a: items, paren: true };
  }
  primary(): Node {
    const k = this.next();
    switch (k.t) {
      case 'num': return N(parseFloat(k.v));
      case 'id': return this.symbol(k.v, k.v);
      case 'word': return S(k.v, `\\text{${k.v}}`);
      case 'open': {
        if (k.v === '{') { const e = this.relationOrExpr(); this.expectClose('}'); return e; }
        if (k.v === '⌊') { const e = this.expr(); this.expectClose('⌋'); return fn('floor', e); }
        if (k.v === '⌈') { const e = this.expr(); this.expectClose('⌉'); return fn('ceil', e); }
        const g = this.group(k.v === '(' ? [')', ']'] : [']', ')']);
        if (k.v === '[' && g.k === 'tuple') (g as any).bracket = true;
        return g;
      }
      case 'bar': {
        if (k.v === '|') { this.absDepth++; const e = this.expr(); this.absDepth--; if (!this.is('bar', '|')) this.err('missing closing |'); this.next(); return fn('abs', e); }
        this.normDepth++; const e = this.expr(); this.normDepth--; if (!this.is('bar', '‖')) this.err('missing closing ‖'); this.next(); return fn('norm', e);
      }
      case 'begin': return this.env(k.v);
      case 'cmd': return this.command(k.v);
      case 'eof': this.err('the expression ends too early');
    }
    this.err(`unexpected “${k.v}”`);
  }
  braced(): Node {
    if (this.is('open', '{')) { this.next(); const e = this.relationOrExpr(); this.expectClose('}'); return e; }
    // \frac12 style
    const k = this.peek();
    if (k.t === 'num' && k.v.length > 1 && !k.v.includes('.')) { this.t[this.i] = { t: 'num', v: k.v.slice(1) }; return N(+k.v[0]); }
    return this.primary();
  }
  command(name: string): Node {
    if (GREEK.includes(name)) {
      if (name === 'Gamma' && this.is('open', '(')) return this.func('gamma');
      const canon = GREEK_CANON[name] ?? name;
      return this.symbol(canon, `\\${name}`);
    }
    if (name === 'pi') return PI;
    if (name === 'infty') return N(Infinity);
    if (name === 'e' || name === 'mathrm') return E;
    if (FUNCS[name] && name !== 'sqrt') return this.func(FUNCS[name]);
    switch (name) {
      case 'sqrt': {
        let idx: Node | null = null;
        if (this.is('open', '[')) { this.next(); idx = this.expr(); this.expectClose(']'); }
        const a = this.braced();
        if (!idx) return pow(a, 0.5);
        return pow(a, pow(idx, -1));
      }
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
        const a = this.braced(), b = this.braced();
        const d = derivOf(a, b); if (d) return d;
        return mul(a, pow(b, -1));
      }
      case 'binom': case 'tbinom': case 'dbinom': { const a = this.braced(), b = this.braced(); return fn('binom', a, b); }
      case 'mathbf': case 'vec': case 'boldsymbol': case 'bm': case 'mathbfit': case 'overrightarrow': case 'mathcal': case 'hat': case 'tilde': case 'bar': case 'overline': case 'check': case 'mathbb': {
        const inner = this.braced();
        if (inner.k === 'sym') {
          const wrapTex = `\\${name}{${inner.tex}}`;
          const suffix = ['hat', 'tilde', 'bar', 'overline', 'check'].includes(name) ? '_' + name : '';
          const s = S(inner.n + suffix, wrapTex); if (['mathbf', 'vec', 'boldsymbol', 'bm', 'mathbfit', 'overrightarrow'].includes(name)) (s as any).bold = true;
          const sub = this.subscriptText();
          if (sub) return { ...s, n: (s as any).n + '_' + sub.name, tex: `${wrapTex}_{${sub.tex}}` } as Node;
          return s;
        }
        return inner;
      }
      case 'dot': case 'ddot': {
        const inner = this.braced();
        if (inner.k !== 'sym') this.err(`\\${name} needs a single variable`);
        return { k: 'deriv', of: inner.n, ofTex: inner.tex, wrt: 't', order: name === 'dot' ? 1 : 2 };
      }
      case 'sum': case 'prod': {
        let i = 'n', lo: Node | null = null, hi: Node | null = null;
        for (let r = 0; r < 2; r++) {
          if (this.is('op', '_')) {
            this.next(); const s = this.scriptArg();
            if (s.k === 'rel' && s.terms[0].k === 'sym') { i = (s.terms[0] as any).n; lo = s.terms[1]; }
            else this.err(`write the ${name} bounds like \\${name}_{n=1}^{10}`);
          } else if (this.is('op', '^')) { this.next(); hi = this.scriptArg(); }
        }
        if (!lo || !hi) this.err(`\\${name} needs both bounds, like \\${name}_{n=1}^{10}`);
        if (hi!.k === 'num' && !isFinite(hi!.v)) this.err('infinite sums are not supported — use a finite upper bound (e.g. 50)');
        const body = this.term(true);
        return { k: 'sum', i, lo: lo!, hi: hi!, body, prod: name === 'prod' };
      }
      case 'int': case 'iint': case 'iiint': case 'oint': this.err('integrals aren’t supported yet — try the integrand or its antiderivative');
      case 'lim': this.err('limits aren’t supported yet');
      case 'partial': case 'nabla': this.err('partial derivatives and ∇ aren’t supported in the input yet — write the function itself and the model will compute its derivatives');
      case 'cdot': case 'times': this.err('a multiplication sign needs something on its left');
    }
    this.err(`the command \\${name} isn’t supported`);
  }
  func(f: string): Node {
    let power: Node | null = null, base: Node | null = null;
    for (let r = 0; r < 2; r++) {
      if (this.is('op', '^')) { this.next(); power = this.scriptArg(); }
      else if (this.is('op', '_')) { this.next(); base = this.scriptArg(); }
    }
    let fname = f;
    if (power && power.k === 'mul' && power.a.length === 2 && power.a[0].k === 'num' && power.a[0].v === -1 && power.a[1].k === 'num' && power.a[1].v === 1) power = N(-1);
    if (power && power.k === 'num' && power.v === -1 && INVERSE[f]) { fname = INVERSE[f]; power = null; }
    let args: Node[];
    if (this.is('open', '(') || this.is('open', '[')) {
      const k = this.next(); const g = this.group(k.v === '(' ? [')'] : [']']);
      args = g.k === 'tuple' ? g.a : [{ ...g, paren: false } as Node];
    } else if (this.is('open', '{')) { this.next(); args = [this.expr()]; this.expectClose('}'); }
    else {
      if (!this.startsFactor()) this.err(`\\${f} needs an argument`);
      args = [this.term(true)];
    }
    let r: Node;
    if (fname === 'sqrt') r = pow(args[0], 0.5);
    else if (fname === 'cbrt') r = pow(args[0], 1 / 3);
    else if (fname === 'det' && args[0].k === 'matrix') r = detExpand((args[0] as any).rows);
    else r = fn(fname, ...args);
    if (base && fname === 'ln') r = isNumNode(base, 10) ? fn('log10', args[0]) : isNumNode(base, 2) ? fn('log2', args[0]) : mul(fn('ln', args[0]), pow(fn('ln', base), -1));
    if (power) r = pow(r, power);
    return r;
  }
  env(name: string): Node {
    const rows: Node[][] = [[]];
    const conds: (Node | null)[][] = [[]];
    const isCases = name === 'cases' || name === 'dcases' || name === 'rcases';
    const isAlign = ['aligned', 'align', 'gathered', 'gather', 'split', 'alignat', 'eqnarray', 'multline'].includes(name);
    for (;;) {
      if (this.is('end')) { this.next(); break; }
      if (this.is('eof')) this.err(`missing \\end{${name}}`);
      if (this.is('row')) { this.next(); rows.push([]); conds.push([]); continue; }
      if (this.is('amp')) { this.next(); if (isAlign) continue; if (!isCases) rows[rows.length - 1].push(null as any); continue; }
      if (isCases && rows[rows.length - 1].length === 1) {
        while (this.is('word')) { const w = this.next().v; if (w === 'otherwise' || w === 'else') conds[conds.length - 1].push(null); }
        if (this.is('row') || this.is('end')) continue;
        if (this.is('op', ',')) { this.next(); continue; }
        conds[conds.length - 1].push(this.relation()); continue;
      }
      if (this.is('op', ',')) { this.next(); continue; }
      rows[rows.length - 1].push(isAlign ? this.relation() : this.relationOrExpr());
    }
    const R = rows.map(r => r.filter(x => x)).filter(r => r.length);
    if (isAlign) {
      // "y &= x^2" rows: a row may be split by & into ["y", "= x^2"] — rejoin
      return { k: 'stmts', a: R.map(r => (r.length === 1 ? r[0] : joinAligned(r))) };
    }
    if (isCases) {
      const cases = R.map((r, i) => ({ v: r[0], c: (conds[i] && conds[i][0]) ?? null }));
      return { k: 'pw', cases };
    }
    if (!R.length) this.err(`empty ${name}`);
    const w = Math.max(...R.map(r => r.length));
    if (w === 1) return { k: 'tuple', a: R.map(r => r[0]) };
    if (R.length === 1) return { k: 'tuple', a: R[0] };
    const M: Node = { k: 'matrix', rows: R.map(r => { const rr = [...r]; while (rr.length < w) rr.push(N(0)); return rr; }) };
    if (name === 'vmatrix' || name === 'Vmatrix') return detExpand((M as any).rows);
    return M;
  }
}

function joinAligned(r: Node[]): Node { return r[0]; }
/** symbolic determinant by cofactor expansion */
export function detExpand(rows: Node[][]): Node {
  const n = rows.length;
  if (n !== rows[0].length) throw new MathError('a determinant needs a square matrix');
  if (n === 1) return rows[0][0];
  if (n === 2) return add(mul(rows[0][0], rows[1][1]), neg(mul(rows[0][1], rows[1][0])));
  const terms: Node[] = [];
  for (let j = 0; j < n; j++) {
    const minor = rows.slice(1).map(r => r.filter((_, k) => k !== j));
    const t = mul(rows[0][j], detExpand(minor));
    terms.push(j % 2 ? neg(t) : t);
  }
  return add(...terms);
}
const isNumNode = (n: Node, v: number) => n.k === 'num' && n.v === v;

/** \frac{dy}{dx}, \frac{d^2y}{dx^2}, \frac{\mathrm{d}y}{\mathrm{d}x} */
function derivOf(a: Node, b: Node): Node | null {
  const parts = (n: Node) => (n.k === 'mul' ? n.a : [n]);
  const pa = parts(a), pb = parts(b);
  const isD = (n: Node) => (n.k === 'sym' && n.n === 'd') || (n.k === 'pow' && n.b.k === 'sym' && (n.b as any).n === 'd');
  if (pa.length === 2 && pb.length === 2 && isD(pa[0]) && isD(pb[0])) {
    const y = pa[1], xx = pb[1];
    const order = pa[0].k === 'pow' && pa[0].e.k === 'num' ? pa[0].e.v : 1;
    const xs = xx.k === 'pow' ? xx.b : xx;
    if (y.k === 'sym' && xs.k === 'sym') return { k: 'deriv', of: y.n, ofTex: y.tex, wrt: xs.n, order };
  }
  return null;
}
