/**
 * Tiny `${{ … }}` expression evaluator.
 *
 * Supports the subset that real workflows use 95%+ of the time:
 *   - identifiers: matrix.foo, env.FOO, secrets.X, github.actor, runner.os,
 *     needs.<job>.outputs.<name>, steps.<id>.outputs.<name>, job.status
 *   - string and number literals
 *   - operators: ==, !=, &&, ||, !, parentheses
 *   - functions: contains(haystack, needle), startsWith(s, p), endsWith(s, s),
 *     toJSON(x), fromJSON(s), success(), failure(), always(), cancelled()
 *
 * Anything outside that list returns `null` and the caller decides how
 * conservative to be.
 */
import type { ExpressionContext, JobStatus } from './types.js';

type Token =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  | { kind: 'dot' }
  | { kind: 'eof' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          value += src[j + 1] ?? '';
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^-?[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i));
      if (m) {
        tokens.push({ kind: 'number', value: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
      if (m) {
        tokens.push({ kind: 'ident', value: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ kind: 'comma' }); i++; continue; }
    if (c === '.') { tokens.push({ kind: 'dot' }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '&&' || two === '||' || two === '>=' || two === '<=') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (c === '!' || c === '<' || c === '>') {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    // Unknown char — skip
    i++;
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

/** Cursor-based recursive descent, returns the evaluated value. */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly ctx: ExpressionContext) {}

  private peek(offset = 0): Token { return this.tokens[this.pos + offset] ?? { kind: 'eof' }; }
  private eat(): Token { return this.tokens[this.pos++] ?? { kind: 'eof' }; }

  parse(): unknown {
    const v = this.parseOr();
    return v;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek().kind === 'op' && (this.peek() as { value: string }).value === '||') {
      this.eat();
      const right = this.parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseEq();
    while (this.peek().kind === 'op' && (this.peek() as { value: string }).value === '&&') {
      this.eat();
      const right = this.parseEq();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private parseEq(): unknown {
    let left = this.parseUnary();
    while (this.peek().kind === 'op') {
      const op = (this.peek() as { value: string }).value;
      if (op !== '==' && op !== '!=' && op !== '<' && op !== '>' && op !== '<=' && op !== '>=') break;
      this.eat();
      const right = this.parseUnary();
      const cmp = compare(left, right);
      switch (op) {
        case '==': left = looseEq(left, right); break;
        case '!=': left = !looseEq(left, right); break;
        case '<':  left = cmp < 0; break;
        case '>':  left = cmp > 0; break;
        case '<=': left = cmp <= 0; break;
        case '>=': left = cmp >= 0; break;
      }
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.peek().kind === 'op' && (this.peek() as { value: string }).value === '!') {
      this.eat();
      return !truthy(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const t = this.peek();
    if (t.kind === 'lparen') { this.eat(); const v = this.parseOr(); if (this.peek().kind === 'rparen') this.eat(); return v; }
    if (t.kind === 'string') { this.eat(); return t.value; }
    if (t.kind === 'number') { this.eat(); return t.value; }
    if (t.kind === 'ident') {
      const name = t.value; this.eat();
      // Function call?
      if (this.peek().kind === 'lparen') {
        this.eat();
        const args: unknown[] = [];
        if (this.peek().kind !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek().kind === 'comma') { this.eat(); args.push(this.parseOr()); }
        }
        if (this.peek().kind === 'rparen') this.eat();
        return this.callFunction(name, args);
      }
      // Property access chain
      let value: unknown = this.lookup(name);
      while (this.peek().kind === 'dot') {
        this.eat();
        const next = this.peek();
        if (next.kind !== 'ident') break;
        this.eat();
        value = (value && typeof value === 'object') ? (value as Record<string, unknown>)[next.value] : undefined;
      }
      return value;
    }
    return null;
  }

  private lookup(name: string): unknown {
    switch (name) {
      case 'matrix': return this.ctx.matrix ?? {};
      case 'env': return this.ctx.env;
      case 'secrets': return this.ctx.secrets;
      case 'vars': return this.ctx.vars;
      case 'github': return this.ctx.github;
      case 'needs': return this.ctx.needs;
      case 'steps': return this.ctx.steps;
      case 'job': return this.ctx.job;
      case 'runner': return this.ctx.runner;
      case 'inputs': return this.ctx.inputs;
      case 'true': return true;
      case 'false': return false;
      case 'null': return null;
      default: return undefined;
    }
  }

  private callFunction(name: string, args: unknown[]): unknown {
    const status: JobStatus = this.ctx.job.status;
    switch (name) {
      case 'success': return status === 'success';
      case 'failure': return status === 'failure';
      case 'cancelled': return status === 'cancelled';
      case 'always': return true;
      case 'contains': {
        const a = args[0];
        const b = String(args[1] ?? '');
        if (Array.isArray(a)) return a.some((x) => String(x) === b || (typeof x === 'string' && x.toLowerCase() === b.toLowerCase()));
        return String(a ?? '').toLowerCase().includes(b.toLowerCase());
      }
      case 'startsWith': return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
      case 'endsWith': return String(args[0] ?? '').endsWith(String(args[1] ?? ''));
      case 'toJSON': return JSON.stringify(args[0] ?? null);
      case 'fromJSON': try { return JSON.parse(String(args[0] ?? 'null')); } catch { return null; }
      case 'format': {
        let s = String(args[0] ?? '');
        for (let i = 1; i < args.length; i++) s = s.replaceAll(`{${i - 1}}`, String(args[i] ?? ''));
        return s;
      }
      case 'join': {
        const arr = Array.isArray(args[0]) ? args[0] : [];
        return arr.map((x) => String(x)).join(String(args[1] ?? ' '));
      }
      default: return null;
    }
  }
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v !== '';
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const an = Number(a); const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

/** Evaluate a `${{ … }}` expression body (without the `${{` `}}` wrapping). */
export function evalBody(src: string, ctx: ExpressionContext): unknown {
  const tokens = tokenize(src);
  return new Parser(tokens, ctx).parse();
}

/**
 * Evaluate a string that may contain one or more `${{ … }}` substitutions.
 * Returns a string (with substitutions interpolated) or, if the entire input
 * is one expression, the raw value.
 */
export function evalExpr(input: string, ctx: ExpressionContext): unknown {
  const trimmed = input.trim();
  const fullMatch = /^\$\{\{([\s\S]+)\}\}$/.exec(trimmed);
  if (fullMatch) return evalBody(fullMatch[1]!, ctx);
  // Substitute occurrences inline as strings
  return input.replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expr) => {
    const v = evalBody(expr, ctx);
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

/** Evaluate an `if:` condition. Always returns boolean. */
export function evalCondition(src: string | undefined, ctx: ExpressionContext): boolean {
  if (!src) return ctx.job.status === 'success';
  const v = evalBody(src.trim().replace(/^\$\{\{|\}\}$/g, '').trim(), ctx);
  return truthy(v);
}
