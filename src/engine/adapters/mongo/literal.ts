import { Decimal128, EJSON, Long, ObjectId } from 'bson';
import { AdapterError } from '../errors';

// D9: a small hand-written JSON5-lite tokenizer/parser for Mongo shell-style literal text —
// unquoted keys, single-quoted strings, and a closed set of BSON constructor calls
// (ObjectId('...'), ISODate('...'), etc.). No eval, no Function, no third-party expression
// evaluator — user-supplied console/filter text must never reach a JS evaluator.

type TokenType = 'punct' | 'string' | 'number' | 'ident' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const PUNCT_CHARS = '{}[]:,().';
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '/': '/',
};

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (PUNCT_CHARS.includes(c)) {
      tokens.push({ type: 'punct', value: c, pos: i });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < n && text[j] !== quote) {
        if (text[j] === '\\' && j + 1 < n) {
          const esc = text[j + 1];
          if (esc === 'u' && j + 5 < n) {
            value += String.fromCharCode(Number.parseInt(text.slice(j + 2, j + 6), 16));
            j += 6;
            continue;
          }
          value += ESCAPES[esc] ?? esc;
          j += 2;
          continue;
        }
        value += text[j];
        j++;
      }
      if (j >= n) throw new AdapterError('E_QUERY', 'unterminated string literal');
      tokens.push({ type: 'string', value, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(text[j])) j++;
      tokens.push({ type: 'number', value: text.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      tokens.push({ type: 'ident', value: text.slice(i, j), pos: i });
      i = j;
      continue;
    }
    throw new AdapterError('E_QUERY', `unexpected character ${JSON.stringify(c)} at position ${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

// Closed set — anything else is a rejected "unrecognized identifier" (no bare-word values).
const CONSTRUCTORS: Record<string, (arg: unknown) => unknown> = {
  ObjectId: (arg) => new ObjectId(arg === undefined ? undefined : String(arg)),
  ISODate: (arg) => new Date(String(arg)),
  Date: (arg) => (arg === undefined ? new Date() : new Date(String(arg))),
  NumberLong: (arg) => Long.fromString(String(arg)),
  NumberInt: (arg) => Number(arg),
  NumberDecimal: (arg) => Decimal128.fromString(String(arg)),
};

export class LiteralParser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(text: string) {
    this.tokens = tokenize(text);
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  atEnd(): boolean {
    return this.peek().type === 'eof';
  }

  peekPunct(value: string): boolean {
    const t = this.peek();
    return t.type === 'punct' && t.value === value;
  }

  expectPunct(value: string): void {
    const t = this.next();
    if (t.type !== 'punct' || t.value !== value) {
      throw new AdapterError('E_QUERY', `expected "${value}" at position ${t.pos}`);
    }
  }

  expectIdent(expected?: string): string {
    const t = this.next();
    if (t.type !== 'ident' || (expected !== undefined && t.value !== expected)) {
      throw new AdapterError(
        'E_QUERY',
        `expected identifier "${expected ?? ''}" at position ${t.pos}`,
      );
    }
    return t.value;
  }

  parseValue(): unknown {
    const t = this.peek();
    if (t.type === 'punct' && t.value === '{') return this.parseObject();
    if (t.type === 'punct' && t.value === '[') return this.parseArray();
    if (t.type === 'string') {
      this.next();
      return t.value;
    }
    if (t.type === 'number') {
      this.next();
      return Number(t.value);
    }
    if (t.type === 'ident') {
      if (t.value === 'true') {
        this.next();
        return true;
      }
      if (t.value === 'false') {
        this.next();
        return false;
      }
      if (t.value === 'null' || t.value === 'undefined') {
        this.next();
        return null;
      }
      const ctor = CONSTRUCTORS[t.value];
      if (ctor && this.tokens[this.pos + 1]?.value === '(') {
        this.next();
        this.expectPunct('(');
        let arg: unknown;
        if (!this.peekPunct(')')) arg = this.parseValue();
        this.expectPunct(')');
        return ctor(arg);
      }
      throw new AdapterError(
        'E_QUERY',
        `unrecognized identifier "${t.value}" at position ${t.pos}`,
      );
    }
    throw new AdapterError('E_QUERY', `unexpected token at position ${t.pos}`);
  }

  private parseKey(): string {
    const t = this.next();
    if (t.type === 'string' || t.type === 'ident') return t.value;
    throw new AdapterError('E_QUERY', `expected an object key at position ${t.pos}`);
  }

  private parseObject(): Record<string, unknown> {
    this.expectPunct('{');
    const obj: Record<string, unknown> = {};
    if (this.peekPunct('}')) {
      this.next();
      return obj;
    }
    for (;;) {
      const key = this.parseKey();
      this.expectPunct(':');
      obj[key] = this.parseValue();
      if (this.peekPunct(',')) {
        this.next();
        if (this.peekPunct('}')) {
          this.next();
          break;
        }
        continue;
      }
      this.expectPunct('}');
      break;
    }
    return obj;
  }

  private parseArray(): unknown[] {
    this.expectPunct('[');
    const arr: unknown[] = [];
    if (this.peekPunct(']')) {
      this.next();
      return arr;
    }
    for (;;) {
      arr.push(this.parseValue());
      if (this.peekPunct(',')) {
        this.next();
        if (this.peekPunct(']')) {
          this.next();
          break;
        }
        continue;
      }
      this.expectPunct(']');
      break;
    }
    return arr;
  }
}

export function parseJson5Literal(text: string): unknown {
  const parser = new LiteralParser(text);
  const value = parser.parseValue();
  if (!parser.atEnd())
    throw new AdapterError('E_QUERY', 'unexpected trailing content after literal');
  return value;
}

// D15: the wrapper keys EJSON v2 defines — a plain object matching one of these shapes is a BSON
// value spelled as extended JSON rather than a shell constructor call (`ObjectId(...)` is already
// resolved to a real ObjectId by CONSTRUCTORS above, at parse time; `{"$oid": "..."}` is not).
const EJSON_WRAPPER_KEYS = new Set([
  '$oid',
  '$date',
  '$numberInt',
  '$numberLong',
  '$numberDouble',
  '$numberDecimal',
  '$binary',
  '$timestamp',
  '$regularExpression',
  '$code',
  '$ref',
  '$minKey',
  '$maxKey',
]);

function looksLikeEjsonWrapper(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.some((k) => EJSON_WRAPPER_KEYS.has(k));
}

// A shell constructor call (ObjectId(...), ISODate(...), NumberLong(...), NumberDecimal(...)) is
// already a real BSON instance by the time this runs — walking its own internal fields would be
// wrong, so those pass through untouched. Plain Date is included: ISODate(...) and Date(...) both
// construct one (CONSTRUCTORS above).
function isResolvedBsonInstance(value: object): boolean {
  return (
    value instanceof ObjectId ||
    value instanceof Date ||
    value instanceof Long ||
    value instanceof Decimal128
  );
}

/**
 * Recursively replaces every extended-JSON wrapper object ({$oid}, {$date}, {$numberLong},
 * {$binary}, …) with the BSON value it denotes, by handing that subtree to `bson`'s own
 * `EJSON.parse`. Leaves every other object alone. This is what makes `{ _id: {"$oid": "507f…"} }`
 * — the exact text *Copy _id* puts on the clipboard (P27 D12) — a working filter (F14).
 */
export function resolveEjsonWrappers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveEjsonWrappers);
  if (value !== null && typeof value === 'object') {
    if (isResolvedBsonInstance(value)) return value;
    if (looksLikeEjsonWrapper(value)) {
      try {
        return EJSON.parse(JSON.stringify(value));
      } catch {
        // The shape matched but the value didn't (e.g. `{ $oid: 123 }`) — fall through and treat
        // it as a plain object; Mongo will reject a meaningless filter with its own error.
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEjsonWrappers(v);
    return out;
  }
  return value;
}

function parseLiteralObject(text: string, errorMessage: string): Record<string, unknown> {
  const value = resolveEjsonWrappers(parseJson5Literal(text));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdapterError('E_QUERY', errorMessage);
  }
  return value as Record<string, unknown>;
}

/**
 * The one grammar every Mongo text surface in the app parses with: shell constructors *and*
 * extended JSON, in the same document. Used by `parseFilterObject` and by `mutate.ts` (D15/D16).
 */
export function parseDocumentLiteral(text: string): Record<string, unknown> {
  return parseLiteralObject(text, 'document must be a JSON object');
}

export function parseFilterObject(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === '') return {};
  return parseLiteralObject(text, 'filter must be a JSON object literal, e.g. { field: "value" }');
}
