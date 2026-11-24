// TikZ and pgfplots → a LaTeX Modeler page. Covers the everyday parts: \draw / \fill / \filldraw / \path with
// straight lines, rectangles, circles, ellipses, arcs, grids, Bézier curves, plots and nodes; \coordinate,
// \node, \foreach; colours, line widths, dashes and arrows; pgfplots axes with \addplot of functions,
// coordinate lists, parametric curves and 3D surfaces. Anything it can't read is listed, never dropped silently.

export interface ImportResult { code: string; warnings: string[]; title: string }

// ---------------------------------------------------------------- expressions (TikZ math: angles in degrees)
type Ex = { k: 'n'; v: number } | { k: 'v'; name: string } | { k: 'u'; op: string; a: Ex } | { k: 'b'; op: string; a: Ex; b: Ex } | { k: 'f'; name: string; args: Ex[] };
const FUN1: Record<string, (x: number) => number> = {
  sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
  asin: x => Math.asin(x) * 180 / Math.PI, acos: x => Math.acos(x) * 180 / Math.PI, atan: x => Math.atan(x) * 180 / Math.PI,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, deg: x => x * 180 / Math.PI, rad: x => x * Math.PI / 180, int: Math.trunc, frac: x => x - Math.floor(x),
  sec: x => 1 / Math.cos(x * Math.PI / 180), cosec: x => 1 / Math.sin(x * Math.PI / 180), cot: x => 1 / Math.tan(x * Math.PI / 180), factorial: x => { let r = 1; for (let i = 2; i <= x; i++) r *= i; return r; },
};
const UNIT: Record<string, number> = { cm: 1, mm: 0.1, pt: 0.0351459, in: 2.54, em: 0.3528 * 10 / 10, ex: 0.155 };

function parseExpr(src: string): Ex {
  const s = src.replace(/\\/g, '').trim(); let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = (t: string) => { ws(); return s.startsWith(t, i); };
  const eat = (t: string) => { if (peek(t)) { i += t.length; return true; } return false; };
  const expr = (): Ex => {
    let a = cmp();
    if (eat('?')) { const b = expr(); if (!eat(':')) throw new Error('bad ?:'); const c = expr(); return { k: 'f', name: 'ifthen', args: [a, b, c] }; }
    return a;
  };
  const cmp = (): Ex => { let a = add(); for (;;) { const op = ['<=', '>=', '==', '!=', '<', '>'].find(o => peek(o)); if (!op) return a; i += op.length; a = { k: 'b', op, a, b: add() }; } };
  const add = (): Ex => { let a = mul(); for (;;) { if (eat('+')) a = { k: 'b', op: '+', a, b: mul() }; else if (peek('-') && !peek('--')) { i++; a = { k: 'b', op: '-', a, b: mul() }; } else return a; } };
  const mul = (): Ex => { let a = una(); for (;;) { if (eat('*')) a = { k: 'b', op: '*', a, b: una() }; else if (eat('/')) a = { k: 'b', op: '/', a, b: una() }; else return a; } };
  const una = (): Ex => { if (eat('-')) return { k: 'u', op: '-', a: una() }; if (eat('+')) return una(); return pow(); };
  const pow = (): Ex => { const a = post(); if (eat('^')) return { k: 'b', op: '^', a, b: una() }; return a; };
  const post = (): Ex => {
    let a = atom(); ws();
    // "3 r" / "\x r": radians to degrees;  "2cm": units
    if (s[i] === 'r' && !/[a-z]/i.test(s[i + 1] ?? '')) { i++; a = { k: 'f', name: 'deg', args: [a] }; }
    const u = /^(cm|mm|pt|in|em|ex)(?![a-z])/i.exec(s.slice(i)); if (u) { i += u[1].length; a = { k: 'b', op: '*', a, b: { k: 'n', v: UNIT[u[1].toLowerCase()] } }; }
    return a;
  };
  const atom = (): Ex => {
    ws();
    if (eat('(') || eat('{')) { const close = s[i - 1] === '(' ? ')' : '}'; const a = expr(); if (!eat(close)) throw new Error('missing ' + close); return a; }
    const n = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (n) { i += n[0].length; return { k: 'n', v: +n[0] }; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) {
      i += id[0].length; const name = id[0];
      if (peek('(')) { i = s.indexOf('(', i) + 1; const args: Ex[] = []; if (!peek(')')) { do args.push(expr()); while (eat(',')); } if (!eat(')')) throw new Error('missing )'); return { k: 'f', name, args }; }
      if (name === 'pi') return { k: 'n', v: Math.PI };
      if (name === 'e') return { k: 'n', v: Math.E };
      return { k: 'v', name };
    }
    throw new Error(`can't read "${s.slice(i, i + 12)}"`);
  };
  const r = expr(); ws(); if (i < s.length) throw new Error(`can't read "${s.slice(i, i + 12)}"`); return r;
}
function evalEx(e: Ex, env: Record<string, number> = {}): number {
  switch (e.k) {
    case 'n': return e.v;
    case 'v': if (e.name in env) return env[e.name]; throw new Error(`unknown "${e.name}"`);
    case 'u': return -evalEx(e.a, env);
    case 'b': {
      const a = evalEx(e.a, env), b = evalEx(e.b, env);
      switch (e.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return Math.pow(a, b);
        case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b); case '==': return +(a === b); case '!=': return +(a !== b); }
      return NaN;
    }
    case 'f': {
      const v = e.args.map(a => evalEx(a, env));
      if (e.name === 'ifthen') return v[0] ? v[1] : v[2];
      if (e.name === 'min') return Math.min(...v); if (e.name === 'max') return Math.max(...v); if (e.name === 'mod') return v[0] % v[1];
      if (e.name === 'atan2') return Math.atan2(v[0], v[1]) * 180 / Math.PI; if (e.name === 'veclen') return Math.hypot(v[0], v[1]); if (e.name === 'pow') return Math.pow(v[0], v[1]);
      const f = FUN1[e.name]; if (!f) throw new Error(`unknown function ${e.name}()`); return f(v[0]);
    }
  }
}
/** the same expression in .bd syntax (where angles are radians), with TikZ variables renamed */
function toBd(e: Ex, vars: Record<string, string>): string {
  const p = (x: Ex) => { const s = toBd(x, vars); return x.k === 'b' || (x.k === 'u') ? `(${s})` : s; };
  switch (e.k) {
    case 'n': return Math.abs(e.v - Math.PI) < 1e-12 ? 'pi' : String(+e.v.toPrecision(12));
    case 'v': if (e.name in vars) return vars[e.name]; throw new Error(`unknown "${e.name}"`);
    case 'u': return '-' + p(e.a);
    case 'b': return `${p(e.a)} ${e.op} ${p(e.b)}`;
    case 'f': {
      const a = e.args.map(x => toBd(x, vars));
      const inner = (x: Ex) => (x.k === 'f' && x.name === 'deg' ? toBd(x.args[0], vars) : `rad(${toBd(x, vars)})`);
      if (['sin', 'cos', 'tan', 'sec', 'cot'].includes(e.name)) return `${e.name}(${inner(e.args[0])})`;
      if (e.name === 'cosec') return `csc(${inner(e.args[0])})`;
      if (['asin', 'acos', 'atan'].includes(e.name)) return `deg(${e.name}(${a[0]}))`;
      if (e.name === 'atan2') return `deg(atan2(${a[0]}, ${a[1]}))`;
      if (e.name === 'ln') return `log(${a[0]})`;
      if (e.name === 'ifthen') return `(${a[0]} ? ${a[1]} : ${a[2]})`;
      if (e.name === 'mod') return `(${a[0]} - ${a[1]} * floor(${a[0]} / ${a[1]}))`;
      if (e.name === 'veclen') return `sqrt((${a[0]})^2 + (${a[1]})^2)`;
      if (e.name === 'pow') return `(${a[0]})^(${a[1]})`;
      if (e.name === 'int') return `(${a[0]} < 0 ? ceil(${a[0]}) : floor(${a[0]}))`;
      if (e.name === 'factorial') return `fact(${a[0]})`;
      if (!(e.name in FUN1) && !['min', 'max'].includes(e.name)) throw new Error(`unknown function ${e.name}()`);
      return `${e.name}(${a.join(', ')})`;
    }
  }
}
const num = (s: string, env: Record<string, number> = {}) => evalEx(parseExpr(s), env);

// ---------------------------------------------------------------- colours (xcolor names and mixes like red!50!black)
const NAMED: Record<string, string> = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', cyan: '#00ffff', magenta: '#ff00ff', yellow: '#ffff00', black: '#000000', white: '#ffffff',
  gray: '#808080', grey: '#808080', darkgray: '#404040', lightgray: '#bfbfbf', brown: '#bf8040', lime: '#bfff00', olive: '#808000', orange: '#ff8000',
  pink: '#ffbfbf', purple: '#bf0040', teal: '#008080', violet: '#800080',
};
function color(spec: string): string | null {
  const parts = spec.trim().split('!').map(s => s.trim()); if (!parts[0]) return null;
  const rgb = (n: string): number[] | null => { const h = NAMED[n.toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(n) ? n : null); if (!h) return null; const v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  let c = rgb(parts[0]); if (!c) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const pct = +parts[i]; if (!isFinite(pct)) return null;
    const other = parts[i + 1] !== undefined ? rgb(parts[i + 1]) : [255, 255, 255]; if (!other) return null;
    c = c.map((x, k) => x * pct / 100 + other[k] * (1 - pct / 100));
  }
  return '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- options  [thick, red, ->, fill=blue!20]
function splitTop(s: string, sep = ','): string[] {
  const out: string[] = []; let d = 0, cur = '';
  for (const ch of s) { if ('{[('.includes(ch)) d++; else if ('}])'.includes(ch)) d--; if (ch === sep && d === 0) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur); return out.map(x => x.trim()).filter(Boolean);
}
const unbrace = (s: string) => { s = s.trim(); while (s.startsWith('{') && s.endsWith('}') && matchEnd(s, 0) === s.length - 1) s = s.slice(1, -1).trim(); return s; };
function matchEnd(s: string, i: number): number { const open = s[i], close = ({ '{': '}', '[': ']', '(': ')' } as any)[open]; let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === open) d++; else if (s[j] === close && --d === 0) return j; } return -1; }

interface Style { color?: string; fill?: string; draw?: string; text?: string; width?: number; dash?: number; arrow?: '' | '->' | '<-' | '<->'; opacity?: number; fillOpacity?: number; size?: number; pos?: string; anchor?: string; scale?: number; extra: Record<string, string> }
const WIDTHS: Record<string, number> = { 'ultra thin': 0.1, 'very thin': 0.2, thin: 0.4, semithick: 0.6, thick: 0.8, 'very thick': 1.2, 'ultra thick': 1.6 };
const FONTS: Record<string, number> = { tiny: 5, scriptsize: 7, footnotesize: 8, small: 9, normalsize: 10, large: 12, Large: 14.4, LARGE: 17.3, huge: 20.7, Huge: 24.9 };
function parseOpts(s: string, warn: (m: string) => void, base: Style = { extra: {} }): Style {
  const st: Style = { ...base, extra: { ...base.extra } };
  for (const raw of splitTop(s)) {
    const o = raw.trim(); const eq = o.indexOf('=');
    const key = (eq < 0 ? o : o.slice(0, eq)).trim(), val = eq < 0 ? '' : unbrace(o.slice(eq + 1));
    if (key in WIDTHS && eq < 0) { st.width = WIDTHS[key]; continue; }
    if (/^(<?-[>|]?|<?-?(stealth|latex|>)|-\{.*\})$/.test(key) || ['->', '<-', '<->', '-stealth', '-latex', 'stealth-', 'latex-', '<->', '-Stealth', '-Latex', '-{Stealth}', '-{Latex}', '-to', '|-|'].includes(key)) {
      st.arrow = key.startsWith('<') || /^(stealth|latex|Stealth|Latex)-/.test(key) ? (key.endsWith('>') || /-(stealth|latex|to)/i.test(key) ? '<->' : '<-') : '->'; continue;
    }
    if (eq < 0 && color(key)) { st.color = color(key)!; continue; }
    switch (key) {
      case 'draw': st.draw = color(val) ?? st.draw ?? '#000000'; if (!val) st.draw = st.draw ?? '__'; break;
      case 'fill': st.fill = color(val) ?? undefined; if (!st.fill) warn(`colour "${val}"`); break;
      case 'color': st.color = color(val) ?? st.color; break;
      case 'text': st.text = color(val) ?? st.text; break;
      case 'line width': try { st.width = num(val) / UNIT.pt; } catch { warn(`line width=${val}`); } break;
      case 'dashed': st.dash = 1.2; break; case 'densely dashed': st.dash = 0.8; break; case 'loosely dashed': st.dash = 2; break;
      case 'dotted': case 'densely dotted': case 'loosely dotted': st.dash = 0.35; break;
      case 'opacity': st.opacity = +val; break; case 'fill opacity': st.fillOpacity = +val; break; case 'draw opacity': st.opacity = +val; break;
      case 'above': case 'below': case 'left': case 'right': case 'above left': case 'above right': case 'below left': case 'below right': st.pos = key; break;
      case 'anchor': st.anchor = val; break;
      case 'scale': st.scale = +val; break;
      case 'font': { const m = /\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)/.exec(val); if (m) st.size = FONTS[m[1]]; break; }
      case 'circle': case 'fill opacity=': case 'inner sep': case 'outer sep': case 'minimum size': case 'rounded corners': case 'shape': case 'midway': case 'pos': case 'sloped': case 'near start': case 'near end': case 'at start': case 'at end': case 'smooth': case 'mark': case 'samples': case 'domain': case 'variable': case 'step': case 'radius': case 'x radius': case 'y radius': case 'start angle': case 'end angle': case 'delta angle': case 'out': case 'in': case 'bend left': case 'bend right': case 'thin': case 'xstep': case 'ystep': case 'help lines': case 'only marks': case 'no marks': case 'mark size': case 'surf': case 'mesh': case 'shader': case 'y domain': case 'view': case 'colormap/viridis': case 'colormap/cool': case 'colormap/hot': case 'line join': case 'line cap':
        st.extra[key] = val; break;
      default:
        if (/^(red|green|blue|black|gray|orange|purple|brown|teal|violet|cyan|magenta|yellow|olive|lime|pink|white|lightgray|darkgray)(!|$)/.test(key) && eq < 0) { const c = color(key); if (c) { st.color = c; break; } }
        st.extra[key] = val;
        if (!['every node/.style', 'scale', 'x', 'y', 'z', 'baseline', 'transform shape', '>', 'thick', 'draw', 'nodes'].includes(key) && !/\/\.style$/.test(key)) warn(`option "${o}"`);
    }
  }
  if (st.extra['help lines'] !== undefined) { st.color = st.color ?? '#bfbfbf'; st.width = st.width ?? 0.2; }
  return st;
}

// ---------------------------------------------------------------- code writer
const fmt = (v: number) => { const r = +v.toFixed(3); return Object.is(r, -0) ? '0' : String(r); };
// .bd strings are raw (a backslash is just a backslash); only \" is special
const q = (s: string) => '"' + s.replace(/\n/g, ' ').replace(/"/g, '\\"').replace(/\\$/, '\\ ') + '"';
/** "Point $A$ is here" → \text{Point }A\text{ is here} */
function nodeTex(s: string): string {
  s = s.trim().replace(/\\\\/g, ' ').replace(/\\(textbf|textit|emph)\{([^{}]*)\}/g, (_m, c, t) => `$\\${c === 'emph' ? 'textit' : c}{${t}}$`);
  if (!s) return '';
  const parts = s.split(/(?<!\\)\$/);
  return parts.map((p, i) => (i % 2 ? p : p ? `\\text{${p.replace(/([{}%#&_])/g, '\\$1')}}` : '')).join('') || '';
}
function bdOpts(st: Style, kind: 'line' | 'fill' | 'tex', mm: (pt: number) => number): string {
  const o: string[] = [];
  const c = kind === 'tex' ? st.text ?? st.color : (st.draw && st.draw !== '__' ? st.draw : st.color);
  if (kind === 'fill') { const f = st.fill ?? st.color; if (f) o.push(`fill: ${q(f)}`); if (st.fillOpacity !== undefined || st.opacity !== undefined) o.push(`opacity: ${fmt(st.fillOpacity ?? st.opacity!)}`); }
  else if (c) o.push(`color: ${q(c)}`);
  if (kind === 'line') { o.push(`width: ${fmt(mm(st.width ?? 0.4))}`); if (st.dash) o.push(`dash: ${fmt(st.dash)}`); if (st.opacity !== undefined) o.push(`opacity: ${fmt(st.opacity)}`); }
  if (kind === 'tex') { o.push(`size: ${fmt((st.size ?? 10) * (st.scale ?? 1))}`); if (st.opacity !== undefined) o.push(`opacity: ${fmt(st.opacity)}`); }
  return o.length ? `{${o.join(', ')}}` : '';
}

// ---------------------------------------------------------------- the converter
export function importTikZ(input: string): ImportResult {
  const warnings = new Set<string>(); const warn = (m: string) => { if (warnings.size < 40) warnings.add(m); };
  let src = input.replace(/(?<!\\)%.*$/gm, '').replace(/\r/g, '');
  const pic = /\\begin\{tikzpicture\}(\[[^\]]*\])?([\s\S]*?)\\end\{tikzpicture\}/.exec(src);
  let picOpts = '', body = src;
  if (pic) { picOpts = pic[1] ? pic[1].slice(1, -1) : ''; body = pic[2]; }
  else if (!/\\(draw|fill|filldraw|path|node|addplot|coordinate|foreach|begin\{axis\})/.test(src)) throw new Error('no TikZ found: paste a tikzpicture or some \\draw / \\addplot commands');
  // \tikzset / \definecolor
  for (const m of src.matchAll(/\\definecolor\{([^}]*)\}\{(HTML|rgb|RGB)\}\{([^}]*)\}/g)) {
    const [name, model, v] = [m[1], m[2], m[3]];
    if (model === 'HTML') NAMED[name] = '#' + v.trim().toLowerCase();
    else { const c = v.split(',').map(x => +x * (model === 'rgb' ? 255 : 1)); if (c.length === 3 && c.every(isFinite)) NAMED[name] = '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); }
  }
  // picture-wide scale / units
  let unitX = 1, unitY = 1;
  for (const o of splitTop(picOpts)) {
    const [k, v] = o.split('=').map(s => s?.trim());
    try { if (k === 'scale') { unitX *= num(v); unitY *= num(v); } else if (k === 'x') unitX *= num(/[a-z]/i.test(v) ? v : v + 'cm'); else if (k === 'y') unitY *= num(/[a-z]/i.test(v) ? v : v + 'cm'); } catch { warn(`picture option "${o}"`); }
  }
  const picStyle = parseOpts(splitTop(picOpts).filter(o => !/^(scale|x|y)\s*=/.test(o)).join(','), () => {});

  // ---- pgfplots: one axis becomes a frame; everything inside it is plotted in it
  const axes = [...body.matchAll(/\\begin\{axis\}(\[[\s\S]*?\])?([\s\S]*?)\\end\{axis\}/g)];
  if (axes.length) return importAxis(axes[0], warn, warnings, axes.length > 1);

  // ---- expand \foreach loops textually
  body = expandForeach(body, warn);
  const stmts = statements(body);

  // ---- first pass: every point, to size the page
  type Cmd = { cmd: string; opts: Style; rest: string; raw: string };
  const cmds: Cmd[] = [];
  for (const s of stmts) {
    const m = /^\\(draw|fill|filldraw|path|node|coordinate|shade|shadedraw|clip|tikzset|matrix|pic)\b\s*/.exec(s);
    if (!m) { if (s.trim()) warn(`"${s.slice(0, 40)}…"`); continue; }
    let rest = s.slice(m[0].length), opts = '';
    if (rest.startsWith('[')) { const e = matchEnd(rest, 0); opts = rest.slice(1, e); rest = rest.slice(e + 1); }
    if (['shade', 'shadedraw', 'clip', 'matrix', 'pic'].includes(m[1])) { warn(`\\${m[1]}`); if (m[1] !== 'shade' && m[1] !== 'shadedraw') continue; }
    if (m[1] === 'tikzset') continue;
    cmds.push({ cmd: m[1].replace(/^shade(draw)?$/, 'fill'), opts: parseOpts(opts, warn, picStyle), rest, raw: s });
  }
  const named: Record<string, [number, number]> = {};
  const out: string[] = []; const pts: [number, number][] = [];
  const bdName = (n: string) => { const s = n.replace(/[^A-Za-z0-9_]/g, '_'); return /^[A-Za-z_]/.test(s) ? 'p_' + s : 'p_' + s; };
  const used = new Set<string>();

  for (const c of cmds) {
    try { convertPath(c.cmd, c.opts, c.rest, named, used, out, pts, warn, unitX, unitY, bdName); }
    catch (e: any) { warn(`couldn't read "${c.raw.slice(0, 50)}…": ${e.message}`); }
  }
  if (!pts.length) throw new Error('nothing to draw was found in this TikZ');
  // fit the picture on an A5 landscape page with a 15 mm margin, at real size when it fits
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (isFinite(x) && isFinite(y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  const W = 210, H = 148, M = 15;
  const k = Math.min(10, (W - 2 * M) / Math.max(1e-6, x1 - x0), (H - 2 * M) / Math.max(1e-6, y1 - y0));
  const ox = W / 2 - k * (x0 + x1) / 2, oy = H / 2 - k * (y0 + y1) / 2;
  const head = [
    `// Imported TikZ — converted from TikZ code${k < 10 ? `, scaled to fit the page (1 TikZ cm = ${fmt(k)} mm)` : ' at its real size'}.`,
    `page("A5 landscape", "paper")`, ``,
    `// S turns TikZ coordinates into page millimetres; k is the size of one TikZ unit`,
    `k = ${fmt(k)}`, `S(x, y) = (${fmt(ox)} + k * x, ${fmt(oy)} + k * y)`,
  ];
  const namedLines = [...used].map(n => `${bdName(n)} = S(${fmt(named[n][0])}, ${fmt(named[n][1])})`);
  const code = [...head, ...(namedLines.length ? ['', '// named coordinates', ...namedLines] : []), '', ...out, ''].join('\n');
  return { code, warnings: [...warnings], title: 'Imported TikZ' };
}

function statements(body: string): string[] {
  const out: string[] = []; let d = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') d++; else if (ch === '}' || ch === ']' || ch === ')') d = Math.max(0, d - 1);
    if (ch === ';' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(s => s.replace(/\s+/g, ' ')).filter(Boolean);
}

/** \foreach \x in {1,2,...,5} {body}  and  \foreach \x/\y in {a/b, c/d} statement; */
function expandForeach(s: string, warn: (m: string) => void, depth = 0): string {
  if (depth > 6) { warn('\\foreach nested too deeply'); return s; }
  const re = /\\foreach\s*((?:\\[a-zA-Z]+\s*\/?\s*)+)(\[[^\]]*\])?\s*in\s*\{/g;
  let m: RegExpExecArray | null, out = '', last = 0, n = 0;
  while ((m = re.exec(s))) {
    const vars = m[1].split('/').map(v => v.trim().replace(/^\\/, ''));
    const lb = m.index + m[0].length - 1, le = matchEnd(s, lb); if (le < 0) break;
    const list = expandList(s.slice(lb + 1, le), warn);
    let rest = le + 1; while (/\s/.test(s[rest] ?? '')) rest++;
    let bodyEnd: number, bodyTxt: string;
    if (s[rest] === '{') { bodyEnd = matchEnd(s, rest); bodyTxt = s.slice(rest + 1, bodyEnd); }
    else { let d = 0, j = rest; for (; j < s.length; j++) { if ('{[('.includes(s[j])) d++; else if ('}])'.includes(s[j])) d--; else if (s[j] === ';' && d === 0) break; } bodyEnd = j; bodyTxt = s.slice(rest, j + 1); }
    let exp = '';
    for (const item of list) {
      if (++n > 4000) { warn('\\foreach makes too many items (stopped at 4000)'); break; }
      const vals = item.split('/'); let b = bodyTxt;
      vars.forEach((v, i) => { b = b.replace(new RegExp('\\\\' + v + '(?![a-zA-Z])', 'g'), () => (vals[i] ?? vals[0]).trim()); });
      exp += b.trim().endsWith(';') || b.trim().endsWith('}') ? b + '\n' : b + ';\n';
    }
    out += s.slice(last, m.index) + expandForeach(exp, warn, depth + 1);
    last = bodyEnd + 1; re.lastIndex = last;
  }
  return out + s.slice(last);
}
function expandList(s: string, warn: (m: string) => void): string[] {
  const items = splitTop(s);
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i] === '...' && i >= 1 && i + 1 < items.length) {
      const a = +items[i - 1], b = +items[i + 1], step = i >= 2 && isFinite(+items[i - 2]) ? a - +items[i - 2] : (b >= a ? 1 : -1);
      if (![a, b, step].every(isFinite) || step === 0) { warn('a \\foreach range it could not count'); continue; }
      for (let v = a + step, c = 0; step > 0 ? v < b - 1e-9 : v > b + 1e-9; v += step) { out.push(fmt(v)); if (++c > 2000) break; }
      continue;
    }
    out.push(items[i]);
  }
  return out;
}

function convertPath(cmd: string, st: Style, rest: string, named: Record<string, [number, number]>, used: Set<string>, out: string[], all: [number, number][],
  warn: (m: string) => void, ux: number, uy: number, bdName: (n: string) => string) {
  const mm = (pt: number) => pt * 0.3528;
  const drawn = cmd === 'draw' || cmd === 'filldraw' || (cmd === 'path' && !!st.draw);
  const filled = cmd === 'fill' || cmd === 'filldraw' || (cmd === 'path' && !!st.fill);
  const P = (x: number, y: number) => { all.push([x, y]); return `S(${fmt(x)}, ${fmt(y)})`; };
  let i = 0; const s = rest;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  let cur: [number, number] = [0, 0]; let sub: string[] = []; let subPts: [number, number][] = []; let closed = false;
  const ref = (x: number, y: number, name?: string) => (name && used.has(name) ? bdName(name) : P(x, y));
  const flush = () => {
    if (sub.length >= 2) {
      const lo = bdOpts(st, 'line', mm);
      const opt = (extra = '') => (lo ? ', ' + (extra ? lo.replace(/\}$/, ', ' + extra + '}') : lo) : extra ? `, {${extra}}` : '');
      if (filled) out.push(`poly(${sub.join(', ')}, ${bdOpts(st, 'fill', mm) || `{fill: ${q(st.fill ?? st.color ?? '#000000')}}`})`);
      const n = sub.length;
      if (drawn && st.arrow && !closed) {
        if (st.arrow === '<->' && n === 2) out.push(`arrow(${sub[0]}, ${sub[1]}${opt('both: 1')})`);
        else {
          const head = st.arrow !== '<-', tail = st.arrow !== '->';
          const mid = sub.slice(tail ? 1 : 0, head ? n - 1 : n);
          if (mid.length >= 2) out.push(`line(${mid.join(', ')}${opt()})`);
          if (tail) out.push(`arrow(${sub[1]}, ${sub[0]}${opt()})`);
          if (head) out.push(`arrow(${sub[n - 2]}, ${sub[n - 1]}${opt()})`);
        }
      } else if (drawn) out.push(`line(${sub.join(', ')}${opt(closed ? 'closed: 1' : '')})`);
    }
    sub = []; subPts = []; closed = false;
  };
  const readCoord = (): { x: number; y: number; name?: string } | null => {
    ws(); let rel = 0;
    if (s.startsWith('++', i)) { rel = 2; i += 2; } else if (s[i] === '+' && s[i + 1] === '(') { rel = 1; i += 1; }
    ws(); if (s[i] !== '(') return null;
    const e = matchEnd(s, i); const inner = s.slice(i + 1, e).trim(); i = e + 1;
    let x: number, y: number, name: string | undefined;
    const pointOf = (t: string): [number, number] => {
      t = t.trim(); const base = t.split('.')[0].trim();
      if (named[base] && !t.includes(',')) { used.add(base); return named[base]; }
      const [a, b] = splitTop(t); return [num(a) * ux, num(b) * uy];
    };
    const perp = /^(.*?)\s*(\|-|-\|)\s*(.*)$/.exec(inner);
    if (perp && !/^-?[\d.]/.test(perp[3]) || (perp && perp[1].includes(','))) {
      // (A |- B): x of A, y of B;  (A -| B): y of A, x of B
      const A = pointOf(perp![1]), Bp = pointOf(perp![3]);
      [x, y] = perp![2] === '|-' ? [A[0], Bp[1]] : [Bp[0], A[1]];
    } else if (perp) { const A = pointOf(perp[1]), Bp = pointOf(perp[3]); [x, y] = perp[2] === '|-' ? [A[0], Bp[1]] : [Bp[0], A[1]]; }
    else if (/^[\w\s.-]+$/.test(inner) && !/^-?[\d.]+(\s*(cm|mm|pt))?$/.test(inner) && !inner.includes(',') && !inner.includes(':')) {
      const base = inner.split('.')[0].trim();
      if (!named[base]) throw new Error(`unknown coordinate (${inner})`);
      if (inner.includes('.')) warn('node anchors like (A.north): the centre is used');
      [x, y] = named[base]; name = base; used.add(base);
    } else if (inner.includes(':') && !inner.includes(',')) {
      const [a, r] = inner.split(':'); const ang = num(a), rad = num(/[a-z]/i.test(r) ? r : r);
      x = rad * Math.cos(ang * Math.PI / 180) * ux; y = rad * Math.sin(ang * Math.PI / 180) * uy;
    } else if (inner.startsWith('$')) { throw new Error('calc coordinates ($…$)'); }
    else { const [a, b, c] = splitTop(inner); if (c !== undefined) warn('3D coordinates: z is ignored'); x = num(a) * ux; y = num(b) * uy; }
    if (rel) { x += cur[0]; y += cur[1]; name = undefined; }
    if (rel !== 1) cur = [x, y];
    all.push([x, y]);
    return { x, y, name };
  };
  const nodeAt = (x: number, y: number) => {
    ws(); let o = st;
    if (s[i] === '[') { const e = matchEnd(s, i); o = parseOpts(s.slice(i + 1, e), warn, { ...st, arrow: undefined, extra: {} }); i = e + 1; ws(); }
    if (s[i] === '(') { const e = matchEnd(s, i); const nm = s.slice(i + 1, e).trim(); named[nm] = [x, y]; i = e + 1; ws(); }
    if (s.startsWith('at', i)) { i += 2; const c = readCoord(); if (c) { x = c.x; y = c.y; } ws(); }
    if (s[i] === '[') { const e = matchEnd(s, i); o = parseOpts(s.slice(i + 1, e), warn, o); i = e + 1; ws(); }
    if (s[i] !== '{') return;
    const e = matchEnd(s, i); const text = s.slice(i + 1, e); i = e + 1;
    const t = nodeTex(text); if (!t) return;
    const off = 2; const pos = o.pos ?? '';
    const dx = pos.includes('left') ? -off : pos.includes('right') ? off : 0, dy = pos.includes('above') ? off : pos.includes('below') ? -off : 0;
    const anchor = o.anchor ? ({ north: 'n', south: 's', east: 'e', west: 'w', center: 'c', 'north east': 'ne', 'north west': 'nw', 'south east': 'se', 'south west': 'sw', 'base': 'c', 'mid': 'c' } as any)[o.anchor] ?? 'c'
      : (dy > 0 ? 's' : dy < 0 ? 'n' : '') + (dx > 0 ? 'w' : dx < 0 ? 'e' : '') || 'c';
    all.push([x, y]);
    const opts = bdOpts(o, 'tex', mm).replace(/\}$/, anchor !== 'c' ? `, anchor: ${q(anchor)}}` : '}');
    out.push(`tex(${q(t)}, S(${fmt(x)}, ${fmt(y)})${dx || dy ? ` + (${fmt(dx)}, ${fmt(dy)})` : ''}, ${opts})`);
  };

  if (cmd === 'coordinate') {
    ws(); if (s[i] === '(') { const e = matchEnd(s, i); const nm = s.slice(i + 1, e).trim(); i = e + 1; ws(); if (s.startsWith('at', i)) { i += 2; const c = readCoord(); if (c) named[nm] = [c.x, c.y]; } }
    return;
  }
  if (cmd === 'node') { nodeAt(cur[0], cur[1]); return; }

  let last = '';
  while (i < s.length) {
    ws(); if (i >= s.length) break;
    if (s.startsWith('--', i)) { i += 2; ws(); if (s.startsWith('cycle', i)) { i += 5; if (sub.length) { closed = true; } continue; } const c = readCoord(); if (!c) throw new Error('-- needs a point'); sub.push(ref(c.x, c.y, c.name)); subPts.push([c.x, c.y]); last = '--'; continue; }
    if (s.startsWith('-|', i) || s.startsWith('|-', i)) {
      const hv = s.startsWith('-|', i); i += 2; const from = cur; const c = readCoord(); if (!c) throw new Error('-| needs a point');
      const corner: [number, number] = hv ? [c.x, from[1]] : [from[0], c.y];
      sub.push(P(corner[0], corner[1]), ref(c.x, c.y, c.name)); continue;
    }
    if (s.startsWith('to', i) && !/[a-z]/i.test(s[i + 2] ?? '')) {
      i += 2; ws(); if (s[i] === '[') { const e = matchEnd(s, i); warn('to[...] curves are drawn straight'); i = e + 1; }
      const c = readCoord(); if (!c) throw new Error('to needs a point'); sub.push(ref(c.x, c.y, c.name)); continue;
    }
    if (s.startsWith('..', i)) {
      i += 2; ws(); if (!s.startsWith('controls', i)) throw new Error('.. without controls'); i += 8;
      const from = cur; const c1 = readCoord()!; ws(); let c2 = c1;
      if (s.startsWith('and', i)) { i += 3; c2 = readCoord()!; } ws(); if (!s.startsWith('..', i)) throw new Error('missing .. after controls'); i += 2;
      const to = readCoord()!;
      for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; const x = u * u * u * from[0] + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x, y = u * u * u * from[1] + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y; sub.push(P(x, y)); }
      cur = [to.x, to.y]; continue;
    }
    if (s.startsWith('rectangle', i)) {
      i += 9; const a = cur; const c = readCoord()!; flush();
      const corners = [P(a[0], a[1]), P(c.x, a[1]), P(c.x, c.y), P(a[0], c.y)];
      if (filled) out.push(`poly(${corners.join(', ')}, ${bdOpts(st, 'fill', mm) || `{fill: ${q('#000000')}}`})`);
      if (drawn) out.push(`line(${corners.join(', ')}, ${bdOpts(st, 'line', mm).replace(/\}$/, ', closed: 1}') || '{closed: 1}'})`);
      sub = [P(c.x, c.y)]; continue;
    }
    if (s.startsWith('grid', i)) {
      i += 4; ws(); const gst = { ...st, extra: { ...st.extra } };
      if (s[i] === '[') { const e = matchEnd(s, i); Object.assign(gst.extra, parseOpts(s.slice(i + 1, e), () => {}, { extra: {} }).extra); i = e + 1; }
      const a = cur; const c = readCoord()!; flush();
      st = gst;
      const step = st.extra.step ? num(st.extra.step) : 1; const xs = st.extra.xstep ? num(st.extra.xstep) : step, ys = st.extra.ystep ? num(st.extra.ystep) : step;
      const [gx0, gx1] = [Math.min(a[0], c.x), Math.max(a[0], c.x)], [gy0, gy1] = [Math.min(a[1], c.y), Math.max(a[1], c.y)];
      P(gx0, gy0); P(gx1, gy1);
      const lo = bdOpts({ ...st, color: st.color ?? '#bfbfbf' }, 'line', mm);
      out.push(`for gx in range(${fmt(Math.ceil(gx0 / xs - 1e-9) * xs)}, ${fmt(gx1 + 1e-9)}, ${fmt(xs)}) { line(S(gx, ${fmt(gy0)}), S(gx, ${fmt(gy1)}), ${lo}) }`);
      out.push(`for gy in range(${fmt(Math.ceil(gy0 / ys - 1e-9) * ys)}, ${fmt(gy1 + 1e-9)}, ${fmt(ys)}) { line(S(${fmt(gx0)}, gy), S(${fmt(gx1)}, gy), ${lo}) }`);
      sub = [P(c.x, c.y)]; continue;
    }
    if (s.startsWith('circle', i) || s.startsWith('ellipse', i)) {
      const ell = s.startsWith('ellipse', i); i += ell ? 7 : 6; ws();
      let rx = 1, ry = 1;
      if (s[i] === '[') { const e = matchEnd(s, i); const o = parseOpts(s.slice(i + 1, e), () => {}, { extra: {} }); i = e + 1; const r = o.extra.radius; rx = num(o.extra['x radius'] ?? r ?? '1'); ry = num(o.extra['y radius'] ?? r ?? '1'); }
      else if (s[i] === '(') { const e = matchEnd(s, i); const parts = s.slice(i + 1, e).split(/\s+and\s+/); i = e + 1; rx = num(parts[0]); ry = parts[1] !== undefined ? num(parts[1]) : rx; }
      rx *= ux; ry *= uy; flush();
      const c = cur; all.push([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry]);
      const lo = bdOpts(st, 'line', mm);
      if (Math.abs(rx - ry) < 1e-9) {
        const parts: string[] = []; if (filled) parts.push(bdOpts(st, 'fill', mm).replace(/^\{|\}$/g, '') || `fill: ${q('#000000')}`); if (drawn) parts.push(`stroke: ${q(st.draw && st.draw !== '__' ? st.draw : st.color ?? '#000000')}`, ...(lo.match(/width: [\d.]+|dash: [\d.]+/g) ?? []));
        out.push(`circle(S(${fmt(c[0])}, ${fmt(c[1])}), ${fmt(rx)} * k, {${parts.join(', ')}})`);
      } else {
        if (filled) out.push(`poly(map(linspace(0, tau, 97), s => S(${fmt(c[0])} + ${fmt(rx)} * cos(s), ${fmt(c[1])} + ${fmt(ry)} * sin(s))), ${bdOpts(st, 'fill', mm) || `{fill: ${q('#000000')}}`})`);
        if (drawn) out.push(`curve(s => S(${fmt(c[0])} + ${fmt(rx)} * cos(s), ${fmt(c[1])} + ${fmt(ry)} * sin(s)), 0, tau, ${lo || '{}'})`);
      }
      sub = [P(c[0], c[1])]; continue;
    }
    if (s.startsWith('arc', i)) {
      i += 3; ws(); let a0 = 0, a1 = 90, r = 1;
      if (s[i] === '(') { const e = matchEnd(s, i); const [p0, p1, p2] = s.slice(i + 1, e).split(':'); i = e + 1; a0 = num(p0); a1 = num(p1); r = num(p2.split(/\s+and\s+/)[0]); }
      else if (s[i] === '[') { const e = matchEnd(s, i); const o = parseOpts(s.slice(i + 1, e), () => {}, { extra: {} }); i = e + 1; a0 = num(o.extra['start angle'] ?? '0'); r = num(o.extra.radius ?? '1'); a1 = o.extra['end angle'] !== undefined ? num(o.extra['end angle']) : a0 + num(o.extra['delta angle'] ?? '90'); }
      r *= ux;
      const cx = cur[0] - r * Math.cos(a0 * Math.PI / 180), cy = cur[1] - r * Math.sin(a0 * Math.PI / 180);
      const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 6));
      if (!sub.length) sub.push(P(cur[0], cur[1]));
      for (let k = 1; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; sub.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
      cur = [cx + r * Math.cos(a1 * Math.PI / 180), cy + r * Math.sin(a1 * Math.PI / 180)]; continue;
    }
    if (s.startsWith('node', i)) { i += 4; nodeAt(cur[0], cur[1]); continue; }
    if (s.startsWith('plot', i)) {
      i += 4; ws(); let o = st;
      if (s[i] === '[') { const e = matchEnd(s, i); o = parseOpts(s.slice(i + 1, e), () => {}, st); i = e + 1; ws(); }
      if (s.startsWith('coordinates', i)) {
        i += 11; ws(); const e = matchEnd(s, i); const inner = s.slice(i + 1, e); i = e + 1;
        for (const m of inner.matchAll(/\(([^()]*)\)/g)) { const [a, b] = splitTop(m[1]); const x = num(a) * ux, y = num(b) * uy; sub.push(P(x, y)); cur = [x, y]; }
        continue;
      }
      if (s[i] !== '(') throw new Error('plot needs (x, y)');
      const e = matchEnd(s, i); const [ex, ey] = splitTop(s.slice(i + 1, e)); i = e + 1;
      const dom = (o.extra.domain ?? '-5:5').split(':'); const a = num(dom[0]), b = num(dom[1]); const n = Math.max(2, Math.min(2000, +(o.extra.samples || 25)));
      const v = (o.extra.variable ?? '\\x').replace(/^\\/, '');
      const X = parseExpr(ex), Yy = parseExpr(ey);
      flush();
      for (let k = 0; k <= 8; k++) { const t = a + (b - a) * k / 8; try { all.push([evalEx(X, { [v]: t }) * ux, evalEx(Yy, { [v]: t }) * uy]); } catch { /* skip */ } }
      try {
        const bx = toBd(X, { [v]: 's' }), by = toBd(Yy, { [v]: 's' });
        out.push(`curve(s => S(${ux !== 1 ? fmt(ux) + ' * ' : ''}(${bx}), ${uy !== 1 ? fmt(uy) + ' * ' : ''}(${by})), ${fmt(a)}, ${fmt(b)}, ${bdOpts(o, 'line', mm).replace(/\}$/, `, n: ${n * 4}}`) || `{n: ${n * 4}}`})`);
      } catch (err: any) { warn(`plot: ${err.message}`); }
      continue;
    }
    if (s[i] === '[') { const e = matchEnd(s, i); i = e + 1; continue; }   // options mid-path
    if (s.startsWith('coordinate', i)) { i += 10; ws(); if (s[i] === '(') { const e = matchEnd(s, i); named[s.slice(i + 1, e).trim()] = [...cur]; i = e + 1; } continue; }
    if (s[i] === '(' || s[i] === '+') {   // a move-to: starts a new piece of path
      flush(); const c = readCoord(); if (!c) throw new Error('bad point'); sub = [ref(c.x, c.y, c.name)]; subPts = [[c.x, c.y]]; last = 'move'; continue;
    }
    if (s.startsWith('edge', i)) { warn('edge: drawn as straight lines'); i += 4; ws(); if (s[i] === '[') i = matchEnd(s, i) + 1; const from = cur; const c = readCoord()!; out.push(`line(${P(from[0], from[1])}, ${ref(c.x, c.y, c.name)}${bdOpts(st, 'line', mm) ? ', ' + bdOpts(st, 'line', mm) : ''})`); cur = from; continue; }
    if (s.startsWith('parabola', i) || s.startsWith('sin', i) || s.startsWith('cos', i)) { warn(`path operation "${s.slice(i, i + 8)}"`); i = s.length; break; }
    throw new Error(`unexpected "${s.slice(i, i + 15)}"`);
  }
  void last;
  flush();
}

// ---------------------------------------------------------------- pgfplots
const CYCLE = ['#1f4fd1', '#d62728', '#8c564b', '#000000', '#2ca02c', '#9467bd', '#ff7f0e'];
function importAxis(m: RegExpMatchArray, warn: (s: string) => void, warnings: Set<string>, more: boolean): ImportResult {
  if (more) warn('only the first axis is imported');
  const optsTxt = m[1] ? m[1].slice(1, -1) : ''; const body = m[2];
  const ao: Record<string, string> = {};
  for (const o of splitTop(optsTxt)) { const e = o.indexOf('='); ao[(e < 0 ? o : o.slice(0, e)).trim()] = e < 0 ? '' : unbrace(o.slice(e + 1)); }
  const n = (k: string) => (ao[k] !== undefined && ao[k] !== '' ? num(ao[k]) : undefined);
  const dom = (ao.domain ?? '-5:5').split(':').map(x => num(x)); const samples = n('samples') ?? 50;
  const plots = [...body.matchAll(/\\addplot(3?)(\+?)\s*(\[[^\]]*\])?\s*([\s\S]*?);/g)];
  const li = body.indexOf('\\legend{'); const le = li >= 0 ? matchEnd(body, li + 7) : -1;
  const legend = le > 0 ? [body.slice(li, le + 1), body.slice(li + 8, le)] : null;
  const is3d = plots.some(p => p[1] === '3');
  const label = (s?: string) => (s ? nodeTex(s.replace(/^\{|\}$/g, '')) : '');
  const out: string[] = [];
  const title = ao.title ? nodeTex(ao.title) : '';
  out.push(`// Imported pgfplots — converted from a pgfplots axis.`, is3d ? `page("A5", "paper")` : `page("A5 landscape", "paper")`, '');
  if (title) out.push(`tex(${q(title)}, ${is3d ? '(74, 196)' : '(105, 138)'}, {size: 13})`);
  // y range from the functions when not given
  let x0 = n('xmin') ?? dom[0], x1 = n('xmax') ?? dom[1];
  let y0 = n('ymin'), y1 = n('ymax');
  const fns: { bd: string; ev: (x: number) => number; opts: Style; a: number; b: number; kind: string; extra?: string; ex?: Ex }[] = [];
  const fail = (what: string, e: any) => warn(`${what}: ${e.message || e}`);
  const ys: number[] = [];
  plots.forEach((p, idx) => {
    const st = parseOpts(p[3] ? p[3].slice(1, -1) : '', w => warn(w), { extra: {} });
    if (!st.color && !st.draw) st.color = CYCLE[idx % CYCLE.length];
    const d = st.extra.domain ? st.extra.domain.split(':').map(x => num(x)) : dom;
    const what = p[4].trim();
    try {
      if (/^coordinates/.test(what)) {
        const pts = [...what.matchAll(/\(([^()]*)\)/g)].map(c => splitTop(c[1]).map(v => num(v)));
        pts.forEach(pp => { ys.push(pp[1]); });
        fns.push({ bd: '', ev: () => NaN, opts: st, a: 0, b: 0, kind: 'coords', extra: JSON.stringify(pts) });
        if (n('xmin') === undefined) { x0 = Math.min(x0, ...pts.map(pp => pp[0])); x1 = Math.max(x1, ...pts.map(pp => pp[0])); }
        return;
      }
      if (/^table/.test(what) || /^file/.test(what)) { warn('\\addplot table / file (the data isn\'t in the code)'); return; }
      if (p[1] === '3') {
        const ex = parseExpr(unbrace(what)); const yd = st.extra['y domain'] ? st.extra['y domain'].split(':').map(x => num(x)) : ao['y domain'] ? ao['y domain'].split(':').map(x => num(x)) : d;
        fns.push({ bd: toBd(ex, { x: 'x', y: 'y' }), ev: () => NaN, opts: st, a: d[0], b: d[1], kind: 'surf', extra: JSON.stringify(yd), ex });
        return;
      }
      const par = /^\(\s*(\{[\s\S]*\}|[^,]+)\s*,\s*(\{[\s\S]*\}|[^)]+)\s*\)$/.exec(what);
      if (par) {
        const X = parseExpr(unbrace(par[1])), Y = parseExpr(unbrace(par[2]));
        for (let k = 0; k <= 60; k++) { const t = d[0] + (d[1] - d[0]) * k / 60; try { ys.push(evalEx(Y, { x: t, t })); if (n('xmin') === undefined) { const xv = evalEx(X, { x: t, t }); x0 = Math.min(x0, xv); x1 = Math.max(x1, xv); } } catch { /* skip */ } }
        fns.push({ bd: `(${toBd(X, { x: 's', t: 's' })}, ${toBd(Y, { x: 's', t: 's' })})`, ev: () => NaN, opts: st, a: d[0], b: d[1], kind: 'param' });
        return;
      }
      const ex = parseExpr(unbrace(what));
      for (let k = 0; k <= 80; k++) { const x = d[0] + (d[1] - d[0]) * k / 80; try { const v = evalEx(ex, { x }); if (isFinite(v)) ys.push(v); } catch { /* skip */ } }
      fns.push({ bd: toBd(ex, { x: 'x' }), ev: () => NaN, opts: st, a: d[0], b: d[1], kind: 'fn' });
    } catch (e) { fail(`\\addplot ${what.slice(0, 30)}`, e); }
  });
  if (!fns.length) throw new Error('no \\addplot it could read');
  if (y0 === undefined || y1 === undefined) {
    const fin = ys.filter(isFinite).sort((a, b) => a - b);
    const lo = fin.length ? fin[Math.floor(fin.length * 0.02)] : -1, hi = fin.length ? fin[Math.ceil(fin.length * 0.98) - 1] : 1;
    const pad = (hi - lo) * 0.08 || 1; y0 = y0 ?? lo - pad; y1 = y1 ?? hi + pad;
  }
  if (!(x1 > x0)) x1 = x0 + 1; if (!(y1! > y0!)) y1 = y0! + 1;
  const xl = label(ao.xlabel), yl = label(ao.ylabel), zl = label(ao.zlabel);
  const lab = [xl && `xlabel: ${q(xl)}`, yl && `ylabel: ${q(yl)}`].filter(Boolean).join(', ');
  if (is3d) {
    const sf = fns.find(f => f.kind === 'surf');
    if (!sf) throw new Error('a 3D axis needs \\addplot3 with a function of x and y');
    const yd: number[] = JSON.parse(sf.extra!);
    let z0 = n('zmin'), z1 = n('zmax');
    if (z0 === undefined || z1 === undefined) {
      const zs: number[] = [];
      for (let a = 0; a <= 24; a++) for (let b = 0; b <= 24; b++) { try { const v = evalEx(sf.ex!, { x: sf.a + (sf.b - sf.a) * a / 24, y: yd[0] + (yd[1] - yd[0]) * b / 24 }); if (isFinite(v)) zs.push(v); } catch { /* skip */ } }
      const lo = zs.length ? Math.min(...zs) : -1, hi = zs.length ? Math.max(...zs) : 1;
      z0 = z0 ?? lo; z1 = z1 ?? (hi > lo ? hi : lo + 1);
    }
    out.push(`B = frame3d((74, 100), 120, (${fmt(sf.a)}, ${fmt(sf.b)}), (${fmt(yd[0])}, ${fmt(yd[1])}), (${fmt(z0)}, ${fmt(z1)}), {labels: [${q(xl || 'x')}, ${q(yl || 'y')}, ${q(zl || 'z')}]})`);
    out.push(`splot(B, (x, y) => ${sf.bd}, {n: ${Math.min(60, Math.max(16, samples))}, colormap: "viridis"${sf.opts.extra.mesh !== undefined ? ', wire: 12' : ''}})`);
    if (fns.length > 1) warn('only the first surface of a 3D axis is imported');
  } else {
    out.push(`F = frame2d((22, 18), (170, 108), (${fmt(x0)}, ${fmt(x1)}), (${fmt(y0!)}, ${fmt(y1!)})${lab ? `, {${lab}}` : ''})`);
    const mm = (pt: number) => pt * 0.3528;
    for (const f of fns) {
      const lo = bdOpts({ ...f.opts, width: f.opts.width ?? 0.8 }, 'line', mm);
      const marks = f.opts.extra['only marks'] !== undefined;
      if (f.kind === 'fn') out.push(`fplot(F, x => ${f.bd}, ${lo.replace(/\}$/, `${f.a > x0 + 1e-9 ? `, from: ${fmt(f.a)}` : ''}${f.b < x1 - 1e-9 ? `, to: ${fmt(f.b)}` : ''}}`)})`);
      else if (f.kind === 'param') out.push(`pplot(F, s => ${f.bd}, (${fmt(f.a)}, ${fmt(f.b)}), ${lo})`);
      else if (f.kind === 'coords') {
        const pts: number[][] = JSON.parse(f.extra!);
        if (!marks) out.push(`line(${pts.map(p => `F.map((${fmt(p[0])}, ${fmt(p[1])}))`).join(', ')}, ${lo})`);
        if (marks || f.opts.extra['no marks'] === undefined) out.push(`for p in [${pts.map(p => `(${fmt(p[0])}, ${fmt(p[1])})`).join(', ')}] { dot(F.map(p), {r: 0.7, color: ${q(f.opts.color ?? '#000000')}}) }`);
      }
    }
    if (legend) splitTop(legend[1]).forEach((t, k) => {
      const c = fns[k]?.opts.color ?? CYCLE[k % CYCLE.length];
      out.push(`line((150, ${fmt(118 - k * 6)}), (158, ${fmt(118 - k * 6)}), {color: ${q(c)}, width: 0.5})`, `tex(${q(nodeTex(t))}, (160, ${fmt(118 - k * 6)}), {size: 8.5, anchor: "w"})`);
    });
  }
  return { code: out.join('\n') + '\n', warnings: [...warnings], title: 'Imported pgfplots' };
}

export const __test = { parseExpr, evalEx, toBd, color, expandForeach };
