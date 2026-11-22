// Tree-walking evaluator for .bd programs.
import { BdError, Vec, Mat, Closure, binop, truthy, typeName, isObj } from './values';
import { lex, Parser } from './parser';
import { makeBuiltins, PAGE_STYLES } from './builtins';

export class Env {
  vars = new Map<string, any>();
  constructor(public parent: Env | null, public readonly = false) {}
  find(n: string): Env | null { for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(n)) return e; return null; }
  set(n: string, v: any) {
    for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(n)) { if (e.readonly) break; e.vars.set(n, v); return; }
    this.vars.set(n, v);
  }
  define(n: string, v: any) { this.vars.set(n, v); }
}

export type Prim = any;
export interface RunCtx {
  prims: Prim[]; page: { w: number; h: number; style: string; stage?: string }; defaults: any; usesT: boolean; duration: number | null; cam: any;
  out: { line: number; text: string }[]; steps: number; depth: number; order: number; line: number; figs: number;
  /** lines of the user-function calls currently being evaluated (outermost first) */
  sites: number[];
  /** view-dependent visibility rule attached to marks while a 3D frame draws its panes and ticks */
  dyn?: any;
  // ---- figure bookkeeping (used by the Figure Explorer)
  frames: { id: number; dim: number; fig: number; args: any[]; line: number; F: any }[];
  hooks: { name: string; frame: number; args: any[]; line: number }[];
  figMeta: Record<number, { dim: number; free?: boolean; R?: number[][]; o?: number[]; s?: number; line?: number }>;
  frameSeq: number; role: any; curHook?: number; noHooks?: boolean; B?: Record<string, any>;
  overrides?: Record<string, number>; globalEnv?: Env;
  call: (f: any, args: any[]) => any; pageStyle: () => any; measure?: (src: string) => number | null;
}

function makeInterpreter(ctx: RunCtx, root: Env) {
  function call(f: any, args: any[], line: number): any {
    if (++ctx.steps > 8e6) throw new BdError('execution limit reached (infinite loop?)', line);
    if (typeof f === 'function') {
      try { return f(...args); }
      catch (e: any) { if (e instanceof BdError) throw e; throw new BdError(e.message, line); }
    }
    if (f instanceof Closure) {
      if (++ctx.depth > 400) { ctx.depth = 0; throw new BdError('recursion too deep', line); }
      const env = new Env(f.env);
      f.params.forEach((p, i) => env.define(p, args[i] ?? null));
      ctx.sites.push(line);
      try { return evalNode(f.body, env); } finally { ctx.depth--; ctx.sites.pop(); }
    }
    throw new BdError(`${typeName(f)} is not a function`, line);
  }
  ctx.call = (f, args) => call(f, args, ctx.line);

  function exec(s: any, env: Env): any {
    ctx.line = s.line;
    switch (s.type) {
      case 'Assign': {
        let v = evalNode(s.value, env);
        // explorer sliders override plain numeric constants at the top level
        if (ctx.overrides && env === ctx.globalEnv && s.name in ctx.overrides && typeof v === 'number' && isNumLiteral(s.value)) v = ctx.overrides[s.name];
        env.set(s.name, v); return v;
      }
      case 'FnDef': { const f = new Closure(s.name, s.params, s.body, env); env.set(s.name, f); return null; }
      case 'Expr': return evalNode(s.expr, env);
      case 'For': {
        let it = evalNode(s.iter, env);
        if (it instanceof Vec) it = it.c;
        if (typeof it === 'number') { const n = it; it = []; for (let i = 0; i < n; i++) it.push(i); }
        if (!Array.isArray(it)) throw new BdError(`can't loop over ${typeName(it)}`, s.line);
        let last = null;
        for (const v of it) {
          if (++ctx.steps > 8e6) throw new BdError('execution limit reached (infinite loop?)', s.line);
          const e = new Env(env); e.define(s.name, v);
          last = evalNode(s.body, e, true);
        }
        return last;
      }
    }
  }
  function evalNode(n: any, env: Env, noScope = false): any {
    switch (n.type) {
      case 'Num': case 'Str': return n.value;
      case 'Id': {
        const e = env.find(n.name);
        if (!e) throw new BdError(`unknown name '${n.name}'`, n.line);
        if (e === root && n.name === 't') ctx.usesT = true;      // only the global timeline t triggers re-evaluation
        return e.vars.get(n.name);
      }
      case 'Tuple': {
        const vals = n.items.map((x: any) => evalNode(x, env));
        let fig = 0;
        vals.forEach((v: any) => { if (typeof v !== 'number') throw new BdError(`vector components must be numbers, got ${typeName(v)}`, n.line); });
        return new Vec(vals, fig);
      }
      case 'List': return n.items.map((x: any) => evalNode(x, env));
      case 'Obj': { const o: any = {}; for (const [k, v] of n.props) o[k] = evalNode(v, env); return o; }
      case 'Block': {
        const e = n.scope && !noScope ? new Env(env) : env; let last = null;
        for (const s of n.body) last = exec(s, e);
        return last;
      }
      case 'Bin': {
        if (n.op === '&&') { const a = evalNode(n.l, env); return truthy(a) ? evalNode(n.r, env) : a; }
        if (n.op === '||') { const a = evalNode(n.l, env); return truthy(a) ? a : evalNode(n.r, env); }
        const a = evalNode(n.l, env), b = evalNode(n.r, env);
        try { return binop(n.op, a, b); } catch (e: any) { throw new BdError(e.message, n.line); }
      }
      case 'Unary': {
        const a = evalNode(n.arg, env);
        if (n.op === '!') return +!truthy(a);
        if (typeof a === 'number') return -a;
        if (a instanceof Vec) return new Vec(a.c.map(x => -x), a.fig);
        if (a instanceof Mat) return a.map(x => -x);
        throw new BdError(`can't negate ${typeName(a)}`, n.line);
      }
      case 'Cond': return truthy(evalNode(n.c, env)) ? evalNode(n.a, env) : (n.b ? evalNode(n.b, env) : null);
      case 'Call': {
        const f = evalNode(n.callee, env);
        const args = n.args.map((a: any) => evalNode(a, env));
        const save = ctx.line; ctx.line = n.line;
        const r = call(f, args, n.line); ctx.line = save; return r;
      }
      case 'Index': {
        const o = evalNode(n.obj, env), i = evalNode(n.idx, env);
        if (typeof i !== 'number') throw new BdError('index must be a number', n.line);
        const arr = o instanceof Vec ? o.c : o instanceof Mat ? o.m.map(r => new Vec(r)) : Array.isArray(o) ? o : typeof o === 'string' ? o : null;
        if (!arr) throw new BdError(`can't index ${typeName(o)}`, n.line);
        const k = i < 0 ? arr.length + i : i;
        if (k < 0 || k >= arr.length) throw new BdError(`index ${i} out of range (length ${arr.length})`, n.line);
        return arr[Math.floor(k)];
      }
      case 'Member': {
        const o = evalNode(n.obj, env);
        if (o instanceof Vec && n.name.length === 1 && 'xyz'.includes(n.name)) return (o as any)[n.name];
        if ((Array.isArray(o) || o instanceof Vec || typeof o === 'string') && (n.name === 'len' || n.name === 'length')) return ((o as any).c || o).length;
        if (isObj(o) && n.name in o) return o[n.name];
        throw new BdError(`${typeName(o)} has no '.${n.name}'`, n.line);
      }
      case 'Lambda': return new Closure(null, n.params, n.body, env);
    }
    throw new BdError('internal: unknown node ' + n.type, n.line);
  }
  return { exec, evalNode, call };
}

export function runProgram(src: string, t: number, hooks: { measure?: (s: string) => number | null; overrides?: Record<string, number> } = {}): RunCtx {
  const ctx: RunCtx = {
    prims: [], page: { w: 210, h: 297, style: 'paper', stage: 'studio' }, defaults: { color: null, width: 0.25, size: 11 }, usesT: false, duration: null, cam: null,
    out: [], steps: 0, depth: 0, order: 0, line: 1, figs: 0, sites: [], frames: [], hooks: [], figMeta: {}, frameSeq: 0, role: null, overrides: hooks.overrides, call: null as any, pageStyle: null as any, measure: hooks.measure,
  };
  ctx.pageStyle = () => PAGE_STYLES[ctx.page.style];
  const ast = new Parser(lex(src)).program();
  const root = new Env(null, true);
  const I = makeInterpreter(ctx, root);
  const B = makeBuiltins(ctx);
  for (const k in B) root.define(k, B[k]);
  root.define('t', t);
  const global = new Env(root);
  ctx.globalEnv = global; ctx.B = B;
  for (const s of ast.body) I.exec(s, global);
  return ctx;
}

const isNumLiteral = (n: any) => n.type === 'Num' || (n.type === 'Unary' && n.op === '-' && n.arg.type === 'Num');

/** top-level `name = number` statements a user might want to drag with a slider */
export function tweakables(src: string): { name: string; value: number; line: number }[] {
  try {
    const ast: any = new Parser(lex(src)).program();
    const out: { name: string; value: number; line: number }[] = [];
    for (const s of ast.body) if (s.type === 'Assign' && isNumLiteral(s.value) && !out.some(o => o.name === s.name))
      out.push({ name: s.name, value: s.value.type === 'Num' ? s.value.value : -s.value.arg.value, line: s.line });
    return out;
  } catch { return []; }
}

export const BUILTIN_NAMES = (() => {
  const ctx: any = { prims: [], defaults: {}, pageStyle: () => ({}), call: () => null, frames: [], hooks: [], figMeta: {} };
  return new Set(Object.keys(makeBuiltins(ctx)));
})();
