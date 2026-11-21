// Lexer + parser for the .bd language.
import { BdError } from './values';

export const KEYWORDS = new Set(['for', 'in', 'if', 'else', 'true', 'false']);
export type Tok = { type: string; value: any; line: number };

export function lex(src: string): Tok[] {
  const toks: Tok[] = []; let i = 0, line = 1; const stack: string[] = [];
  const push = (type: string, value: any, l = line) => toks.push({ type, value, line: l });
  const two = ['==', '!=', '<=', '>=', '&&', '||', '=>', '..'];
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { const top = stack[stack.length - 1]; if (!top || top === '{') push('nl', '\n'); line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]) && src[i - 1] !== '.')) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      push('num', parseFloat(m[0])); i += m[0].length; continue;
    }
    if (c === '"') {
      const start = line; let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
        if (src[j] === '\n') line++;
        s += src[j++];
      }
      if (j >= src.length) throw new BdError('unterminated string', start);
      push('str', s, start); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      push(KEYWORDS.has(m) ? 'kw' : 'id', m); i += m.length; continue;
    }
    const d = src.substr(i, 2);
    if (two.includes(d)) { push('op', d); i += 2; continue; }
    if ('+-*/%^<>=!?:,;.()[]{}'.includes(c)) {
      if (c === '(' || c === '[' || c === '{') stack.push(c);
      if (c === ')' || c === ']' || c === '}') stack.pop();
      push('op', c); i++; continue;
    }
    throw new BdError(`unexpected character '${c}'`, line);
  }
  push('eof', null);
  return toks;
}

const PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '..': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };

export class Parser {
  t: Tok[]; i = 0;
  constructor(toks: Tok[]) { this.t = toks; }
  peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
  next() { return this.t[this.i++]; }
  is(type: string, val?: any) { const k = this.peek(); return k.type === type && (val === undefined || k.value === val); }
  isOp(v: string) { return this.is('op', v); }
  err(msg: string, tok = this.peek()) { return new BdError(msg, tok.line); }
  desc(tok: Tok) { return tok.type === 'eof' ? 'end of file' : tok.type === 'nl' ? 'end of line' : `'${tok.value}'`; }
  expect(v: string) { if (!this.isOp(v)) throw this.err(`expected '${v}' but found ${this.desc(this.peek())}`); return this.next(); }
  skipNl() { while (this.is('nl') || this.isOp(';')) this.i++; }
  skipBreaks() { while (this.is('nl')) this.i++; }

  program() {
    const body: any[] = []; this.skipNl();
    while (!this.is('eof')) {
      body.push(this.statement());
      if (!this.is('eof') && !this.is('nl') && !this.isOp(';')) throw this.err(`unexpected ${this.desc(this.peek())}`);
      this.skipNl();
    }
    return { type: 'Block', body, scope: false };
  }
  statement(): any {
    const line = this.peek().line;
    if (this.is('kw', 'for')) {
      this.next(); const id = this.next(); if (id.type !== 'id') throw this.err('expected a loop variable', id);
      if (!this.is('kw', 'in')) throw this.err("expected 'in'"); this.next();
      const iter = this.expr(); const body = this.block();
      return { type: 'For', name: id.value, iter, body, line };
    }
    const e = this.expr();
    if (this.isOp('=')) {
      this.next(); this.skipBreaks();
      const rhs = this.expr();
      if (e.type === 'Id') return { type: 'Assign', name: e.name, value: rhs, line };
      if (e.type === 'Call' && e.callee.type === 'Id' && e.args.every((a: any) => a.type === 'Id'))
        return { type: 'FnDef', name: e.callee.name, params: e.args.map((a: any) => a.name), body: rhs, line };
      throw new BdError('cannot assign to this expression', line);
    }
    return { type: 'Expr', expr: e, line };
  }
  block() {
    this.expect('{'); const body: any[] = []; this.skipNl();
    while (!this.isOp('}')) {
      if (this.is('eof')) throw this.err("missing '}'");
      body.push(this.statement());
      if (!this.isOp('}') && !this.is('nl') && !this.isOp(';')) throw this.err(`unexpected ${this.desc(this.peek())}`);
      this.skipNl();
    }
    this.next();
    return { type: 'Block', body, scope: true };
  }
  expr(): any {
    const c = this.binary(1);
    if (this.isOp('?')) {
      this.next(); this.skipBreaks(); const a = this.expr(); this.skipBreaks(); this.expect(':'); this.skipBreaks(); const b = this.expr();
      return { type: 'Cond', c, a, b, line: c.line };
    }
    return c;
  }
  binary(min: number): any {
    let left = this.unary();
    for (;;) {
      const k = this.peek(); if (k.type !== 'op') break;
      const p = PREC[k.value]; if (p === undefined || p < min) break;
      this.next(); this.skipBreaks();
      const right = this.binary(p + 1);
      left = { type: 'Bin', op: k.value, l: left, r: right, line: k.line };
    }
    return left;
  }
  unary(): any {
    if (this.isOp('-') || this.isOp('!')) { const k = this.next(); return { type: 'Unary', op: k.value, arg: this.unary(), line: k.line }; }
    return this.power();
  }
  power(): any {
    const b = this.postfix();
    if (this.isOp('^')) { const k = this.next(); return { type: 'Bin', op: '^', l: b, r: this.unary(), line: k.line }; }
    return b;
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(')) { const k = this.next(); const args = this.list(')'); e = { type: 'Call', callee: e, args, line: k.line }; }
      else if (this.isOp('[')) { const k = this.next(); const idx = this.expr(); this.expect(']'); e = { type: 'Index', obj: e, idx, line: k.line }; }
      else if (this.isOp('.')) { const k = this.next(); const id = this.next(); if (id.type !== 'id') throw this.err('expected a name after "."', id); e = { type: 'Member', obj: e, name: id.value, line: k.line }; }
      else break;
    }
    return e;
  }
  list(close: string) {
    const items: any[] = [];
    while (!this.isOp(close)) {
      if (this.is('eof')) throw this.err(`missing '${close}'`);
      items.push(this.expr());
      if (this.isOp(',')) this.next(); else if (!this.isOp(close)) throw this.err(`expected ',' or '${close}' but found ${this.desc(this.peek())}`);
    }
    this.next(); return items;
  }
  lambda(params: string[], line: number) { this.next(); this.skipBreaks(); return { type: 'Lambda', params, body: this.expr(), line }; }
  primary(): any {
    const k = this.peek();
    if (k.type === 'num') { this.next(); return { type: 'Num', value: k.value, line: k.line }; }
    if (k.type === 'str') { this.next(); return { type: 'Str', value: k.value, line: k.line }; }
    if (k.type === 'kw' && (k.value === 'true' || k.value === 'false')) { this.next(); return { type: 'Num', value: k.value === 'true' ? 1 : 0, line: k.line }; }
    if (k.type === 'kw' && k.value === 'if') {
      this.next(); const c = this.expr(); const a = this.block(); let b: any = null;
      const save = this.i; this.skipBreaks();
      if (this.is('kw', 'else')) { this.next(); b = this.is('kw', 'if') ? this.primary() : this.block(); } else this.i = save;
      return { type: 'Cond', c, a, b, line: k.line };
    }
    if (k.type === 'id') {
      this.next();
      if (this.isOp('=>')) return this.lambda([k.value], k.line);
      return { type: 'Id', name: k.value, line: k.line };
    }
    if (k.type === 'op' && k.value === '(') {
      this.next(); const items: any[] = []; let trailing = false;
      while (!this.isOp(')')) {
        if (this.is('eof')) throw this.err("missing ')'");
        items.push(this.expr()); trailing = false;
        if (this.isOp(',')) { this.next(); trailing = true; } else if (!this.isOp(')')) throw this.err(`expected ',' or ')' but found ${this.desc(this.peek())}`);
      }
      this.next();
      if (this.isOp('=>')) {
        if (!items.every(a => a.type === 'Id')) throw this.err('lambda parameters must be names');
        return this.lambda(items.map(a => a.name), k.line);
      }
      if (items.length === 1 && !trailing) return items[0];
      if (items.length === 0) throw this.err('empty parentheses');
      return { type: 'Tuple', items, line: k.line };
    }
    if (k.type === 'op' && k.value === '[') { this.next(); return { type: 'List', items: this.list(']'), line: k.line }; }
    if (k.type === 'op' && k.value === '{') {
      let j = this.i + 1; while (this.t[j].type === 'nl') j++;
      const a = this.t[j], b = this.t[j + 1];
      const isObjLit = (a.type === 'op' && a.value === '}') || ((a.type === 'id' || a.type === 'str') && b.type === 'op' && b.value === ':');
      if (!isObjLit) return this.block();
      this.next(); const props: any[] = [];
      this.skipNl();
      while (!this.isOp('}')) {
        const key = this.next(); if (key.type !== 'id' && key.type !== 'str') throw this.err('expected an option name', key);
        this.expect(':'); this.skipBreaks();
        props.push([key.value, this.expr()]); this.skipBreaks();
        if (this.isOp(',')) { this.next(); this.skipNl(); } else if (!this.isOp('}')) throw this.err(`expected ',' or '}' but found ${this.desc(this.peek())}`);
      }
      this.next(); return { type: 'Obj', props, line: k.line };
    }
    throw this.err(`unexpected ${this.desc(k)}`);
  }
}
