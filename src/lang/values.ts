// Runtime values of the .bd language.

export class BdError extends Error {
  line: number;
  constructor(msg: string, line = 0) { super(msg); this.line = line; }
}

/** A point / vector. `fig` tags points produced by a 3D projector (onpage, frame3d) so
 *  the renderer can lift a whole figure off the paper as one unit. */
export class Vec {
  c: number[];
  fig?: number;
  constructor(c: number[], fig?: number) { this.c = c; if (fig) this.fig = fig; }
  get x() { return this.c[0] ?? 0; }
  get y() { return this.c[1] ?? 0; }
  get z() { return this.c[2] ?? 0; }
  v3(): [number, number, number] { return [this.c[0] ?? 0, this.c[1] ?? 0, this.c[2] ?? 0]; }
  toString() { return '(' + this.c.map(fmtNum).join(', ') + ')'; }
}

/** 3×3 matrix (2×2 matrices are padded with an identity row/column). */
export class Mat {
  m: number[][];
  constructor(m: number[][]) { this.m = m; }
  mulV(v: Vec) {
    const [x, y, z] = v.v3(), m = this.m;
    const r = [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
    return new Vec(v.c.length === 2 ? r.slice(0, 2) : r, v.fig);
  }
  mulM(o: Mat) {
    const a = this.m, b = o.m, r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
    return new Mat(r);
  }
  map(f: (x: number, i: number, j: number) => number) { return new Mat(this.m.map((r, i) => r.map((x, j) => f(x, i, j)))); }
  zip(o: Mat, f: (a: number, b: number) => number) { return new Mat(this.m.map((r, i) => r.map((x, j) => f(x, o.m[i][j])))); }
  toString() { return 'mat[' + this.m.map(r => r.map(fmtNum).join(' ')).join('; ') + ']'; }
}

export class Closure {
  constructor(public name: string | null, public params: string[], public body: any, public env: any) {}
  toString() { return `<fn ${this.name || 'λ'}>`; }
}

export const fmtNum = (x: number) => (!isFinite(x) ? String(x) : Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(+x.toFixed(4)));
export const isObj = (v: any) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
export const typeName = (v: any) =>
  v === null || v === undefined ? 'nothing' : v instanceof Vec ? `vector(${v.c.length})` : v instanceof Mat ? 'matrix' : Array.isArray(v) ? 'list'
    : v instanceof Closure || typeof v === 'function' ? 'function' : isObj(v) ? (v.kind && String(v.kind).startsWith('frame') ? 'frame' : 'options') : typeof v;
export const show = (v: any): string =>
  v === null || v === undefined ? 'nothing' : typeof v === 'number' ? fmtNum(v) : Array.isArray(v) ? '[' + v.map(show).join(', ') + ']'
    : isObj(v) ? (v.kind && String(v.kind).startsWith('frame') ? `<${v.kind}>` : '{' + Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => k + ': ' + show(x)).join(', ') + '}')
    : typeof v === 'function' ? '<builtin>' : String(v);

function vzip(a: Vec, b: Vec, f: (x: number, y: number) => number) {
  const n = Math.max(a.c.length, b.c.length); const r: number[] = [];
  for (let i = 0; i < n; i++) r.push(f(a.c[i] ?? 0, b.c[i] ?? 0));
  return new Vec(r, a.fig || b.fig);
}

export function binop(op: string, a: any, b: any): any {
  const num = typeof a === 'number' && typeof b === 'number';
  switch (op) {
    case '+':
      if (num) return a + b;
      if (typeof a === 'string' || typeof b === 'string') return show(a) + show(b);
      if (a instanceof Vec && b instanceof Vec) return vzip(a, b, (x, y) => x + y);
      if (a instanceof Mat && b instanceof Mat) return a.zip(b, (x, y) => x + y);
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      break;
    case '-':
      if (num) return a - b;
      if (a instanceof Vec && b instanceof Vec) return vzip(a, b, (x, y) => x - y);
      if (a instanceof Mat && b instanceof Mat) return a.zip(b, (x, y) => x - y);
      break;
    case '*':
      if (num) return a * b;
      if (a instanceof Vec && typeof b === 'number') return new Vec(a.c.map(x => x * b), a.fig);
      if (typeof a === 'number' && b instanceof Vec) return new Vec(b.c.map(x => x * a), b.fig);
      if (a instanceof Vec && b instanceof Vec) return vzip(a, b, (x, y) => x * y);
      if (a instanceof Mat && b instanceof Vec) return a.mulV(b);
      if (a instanceof Mat && b instanceof Mat) return a.mulM(b);
      if (a instanceof Mat && typeof b === 'number') return a.map(x => x * b);
      if (typeof a === 'number' && b instanceof Mat) return b.map(x => x * a);
      break;
    case '/':
      if (num) return a / b;
      if (a instanceof Vec && typeof b === 'number') return new Vec(a.c.map(x => x / b), a.fig);
      if (a instanceof Mat && typeof b === 'number') return a.map(x => x / b);
      break;
    case '%': if (num) return ((a % b) + b) % b; break;
    case '^': if (num) return Math.pow(a, b); break;
    case '<': if (num) return +(a < b); break;
    case '>': if (num) return +(a > b); break;
    case '<=': if (num) return +(a <= b); break;
    case '>=': if (num) return +(a >= b); break;
    case '==': return +eq(a, b);
    case '!=': return +!eq(a, b);
    case '..':
      if (num) { const r: number[] = []; for (let i = a; i < b; i++) { r.push(i); if (r.length > 1e5) throw new Error('range too large'); } return r; }
      break;
  }
  throw new Error(`can't apply '${op}' to ${typeName(a)} and ${typeName(b)}`);
}

export function eq(a: any, b: any) {
  if (a instanceof Vec && b instanceof Vec) return a.c.length === b.c.length && a.c.every((x, i) => Math.abs(x - b.c[i]) < 1e-12);
  return a === b;
}
export const truthy = (v: any) => !(v === 0 || v === null || v === undefined || v === '' || Number.isNaN(v) || (Array.isArray(v) && v.length === 0));
