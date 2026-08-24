import type { CellFormat } from './formats';

export type BeautifyMode = 'indented' | 'compact';

export interface BeautifyResult {
  /** The reformatted text, or the input unchanged when `ok` is false. */
  text: string;
  ok: boolean;
  /** Present only when `ok` is false: 'invalid JSON at offset 4021'. Shown on the status line. */
  reason?: string;
}

// ---------------------------------------------------------------------------------------------
// JSON — a lossless scanner (D10). Never JSON.parse/JSON.stringify: a number is reproduced from
// its exact raw slice, never round-tripped through a JS `number`, so a numeric(20,6)-shaped
// literal survives byte-identical. Structural whitespace is the only thing that changes.
// ---------------------------------------------------------------------------------------------

type JsonNode =
  | { kind: 'literal'; raw: string }
  | { kind: 'object'; members: { keyRaw: string; value: JsonNode }[] }
  | { kind: 'array'; items: JsonNode[] };

class JsonScanError extends Error {
  constructor(readonly offset: number) {
    super(`invalid JSON at offset ${offset}`);
  }
}

const JSON_NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function isJsonWs(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

interface Cursor {
  text: string;
  i: number;
}

function skipJsonWs(c: Cursor): void {
  while (isJsonWs(c.text[c.i])) c.i++;
}

function parseJsonString(c: Cursor): string {
  const start = c.i;
  if (c.text[c.i] !== '"') throw new JsonScanError(c.i);
  c.i++;
  for (;;) {
    const ch = c.text[c.i];
    if (ch === undefined) throw new JsonScanError(c.i);
    if (ch === '"') {
      c.i++;
      return c.text.slice(start, c.i);
    }
    if (ch === '\\') {
      const esc = c.text[c.i + 1];
      if (esc === undefined) throw new JsonScanError(c.i);
      if (esc === 'u') {
        for (let k = 0; k < 4; k++) {
          const hex = c.text[c.i + 2 + k];
          if (hex === undefined || !/[0-9a-fA-F]/.test(hex)) throw new JsonScanError(c.i);
        }
        c.i += 6;
      } else if ('"\\/bfnrt'.includes(esc)) {
        c.i += 2;
      } else {
        throw new JsonScanError(c.i);
      }
      continue;
    }
    // JSON forbids raw (unescaped) control characters inside a string.
    if (ch.charCodeAt(0) <= 0x1f) throw new JsonScanError(c.i);
    c.i++;
  }
}

function parseJsonNumber(c: Cursor): string {
  JSON_NUMBER_RE.lastIndex = c.i;
  const m = JSON_NUMBER_RE.exec(c.text);
  if (!m || m.index !== c.i || m[0].length === 0) throw new JsonScanError(c.i);
  c.i += m[0].length;
  return m[0];
}

function parseJsonValue(c: Cursor): JsonNode {
  skipJsonWs(c);
  const ch = c.text[c.i];
  if (ch === '{') return parseJsonObject(c);
  if (ch === '[') return parseJsonArray(c);
  if (ch === '"') return { kind: 'literal', raw: parseJsonString(c) };
  if (ch === '-' || (ch >= '0' && ch <= '9')) return { kind: 'literal', raw: parseJsonNumber(c) };
  if (c.text.startsWith('true', c.i)) {
    c.i += 4;
    return { kind: 'literal', raw: 'true' };
  }
  if (c.text.startsWith('false', c.i)) {
    c.i += 5;
    return { kind: 'literal', raw: 'false' };
  }
  if (c.text.startsWith('null', c.i)) {
    c.i += 4;
    return { kind: 'literal', raw: 'null' };
  }
  throw new JsonScanError(c.i);
}

function parseJsonObject(c: Cursor): JsonNode {
  c.i++; // '{'
  const members: { keyRaw: string; value: JsonNode }[] = [];
  skipJsonWs(c);
  if (c.text[c.i] === '}') {
    c.i++;
    return { kind: 'object', members };
  }
  for (;;) {
    skipJsonWs(c);
    if (c.text[c.i] !== '"') throw new JsonScanError(c.i);
    const keyRaw = parseJsonString(c);
    skipJsonWs(c);
    if (c.text[c.i] !== ':') throw new JsonScanError(c.i);
    c.i++;
    const value = parseJsonValue(c);
    members.push({ keyRaw, value });
    skipJsonWs(c);
    if (c.text[c.i] === ',') {
      c.i++;
      continue;
    }
    if (c.text[c.i] === '}') {
      c.i++;
      break;
    }
    throw new JsonScanError(c.i);
  }
  return { kind: 'object', members };
}

function parseJsonArray(c: Cursor): JsonNode {
  c.i++; // '['
  const items: JsonNode[] = [];
  skipJsonWs(c);
  if (c.text[c.i] === ']') {
    c.i++;
    return { kind: 'array', items };
  }
  for (;;) {
    items.push(parseJsonValue(c));
    skipJsonWs(c);
    if (c.text[c.i] === ',') {
      c.i++;
      continue;
    }
    if (c.text[c.i] === ']') {
      c.i++;
      break;
    }
    throw new JsonScanError(c.i);
  }
  return { kind: 'array', items };
}

type JsonParse = { ok: true; node: JsonNode } | { ok: false; offset: number };

function tryParseJson(text: string): JsonParse {
  const c: Cursor = { text, i: 0 };
  try {
    const node = parseJsonValue(c);
    skipJsonWs(c);
    if (c.i !== text.length) throw new JsonScanError(c.i);
    return { ok: true, node };
  } catch (err) {
    if (err instanceof JsonScanError) return { ok: false, offset: err.offset };
    throw err;
  }
}

/** Used by detect.ts's `json` gate (§5b) — the one definition of "is this JSON" in the app. */
export function scanJson(text: string): { ok: boolean; offset?: number } {
  const r = tryParseJson(text);
  return r.ok ? { ok: true } : { ok: false, offset: r.offset };
}

function renderJsonIndented(node: JsonNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  const padIn = '  '.repeat(depth + 1);
  if (node.kind === 'literal') {
    out.push(node.raw);
    return;
  }
  if (node.kind === 'object') {
    if (node.members.length === 0) {
      out.push('{}');
      return;
    }
    out.push('{\n');
    node.members.forEach((m, idx) => {
      out.push(padIn, m.keyRaw, ': ');
      renderJsonIndented(m.value, depth + 1, out);
      if (idx < node.members.length - 1) out.push(',');
      out.push('\n');
    });
    out.push(pad, '}');
    return;
  }
  if (node.items.length === 0) {
    out.push('[]');
    return;
  }
  out.push('[\n');
  node.items.forEach((item, idx) => {
    out.push(padIn);
    renderJsonIndented(item, depth + 1, out);
    if (idx < node.items.length - 1) out.push(',');
    out.push('\n');
  });
  out.push(pad, ']');
}

function renderJsonCompact(node: JsonNode, out: string[]): void {
  if (node.kind === 'literal') {
    out.push(node.raw);
    return;
  }
  if (node.kind === 'object') {
    out.push('{');
    node.members.forEach((m, idx) => {
      if (idx > 0) out.push(',');
      out.push(m.keyRaw, ':');
      renderJsonCompact(m.value, out);
    });
    out.push('}');
    return;
  }
  out.push('[');
  node.items.forEach((item, idx) => {
    if (idx > 0) out.push(',');
    renderJsonCompact(item, out);
  });
  out.push(']');
}

function beautifyJson(text: string, mode: BeautifyMode): BeautifyResult {
  const r = tryParseJson(text);
  if (!r.ok) return { text, ok: false, reason: `invalid JSON at offset ${r.offset}` };
  const out: string[] = [];
  if (mode === 'indented') renderJsonIndented(r.node, 0, out);
  else renderJsonCompact(r.node, out);
  return { text: out.join(''), ok: true };
}

// ---------------------------------------------------------------------------------------------
// XML / HTML — a lossless scanner (§6b). Attributes are copied verbatim inside their tag, never
// re-quoted/reordered/entity-normalised: only tag boundaries are found, never attribute contents.
// ---------------------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

class XmlScanError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type XmlToken =
  | { kind: 'pi' | 'comment' | 'cdata' | 'doctype' | 'text'; raw: string; offset: number }
  | { kind: 'open'; raw: string; name: string; selfClosing: boolean; offset: number }
  | { kind: 'close'; raw: string; name: string; offset: number };

function tokenizeXml(text: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== '<') {
      const start = i;
      while (i < n && text[i] !== '<') i++;
      tokens.push({ kind: 'text', raw: text.slice(start, i), offset: start });
      continue;
    }
    const start = i;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw new XmlScanError(`unterminated comment at offset ${start}`);
      tokens.push({ kind: 'comment', raw: text.slice(i, end + 3), offset: start });
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlScanError(`unterminated CDATA section at offset ${start}`);
      tokens.push({ kind: 'cdata', raw: text.slice(i, end + 3), offset: start });
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) throw new XmlScanError(`unterminated processing instruction at offset ${start}`);
      tokens.push({ kind: 'pi', raw: text.slice(i, end + 2), offset: start });
      i = end + 2;
      continue;
    }
    if (/^<!doctype/i.test(text.slice(i, i + 9))) {
      let j = i + 9;
      let bracketDepth = 0;
      let closed = false;
      while (j < n) {
        const c = text[j];
        if (c === '[') bracketDepth++;
        else if (c === ']') bracketDepth--;
        else if (c === '>' && bracketDepth <= 0) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) throw new XmlScanError(`unterminated DOCTYPE at offset ${start}`);
      tokens.push({ kind: 'doctype', raw: text.slice(start, j), offset: start });
      i = j;
      continue;
    }
    // an opening or closing tag
    let j = i + 1;
    const closing = text[j] === '/';
    if (closing) j++;
    const nameStart = j;
    while (j < n && /[^\s/>]/.test(text[j])) j++;
    const name = text.slice(nameStart, j);
    if (name.length === 0) throw new XmlScanError(`malformed tag at offset ${start}`);
    let quote: string | null = null;
    let selfClosing = false;
    let closedTag = false;
    while (j < n) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        j++;
        continue;
      }
      if (c === '/' && text[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        closedTag = true;
        break;
      }
      if (c === '>') {
        j++;
        closedTag = true;
        break;
      }
      j++;
    }
    if (!closedTag || quote !== null) throw new XmlScanError(`unterminated tag at offset ${start}`);
    const raw = text.slice(start, j);
    if (closing) {
      if (selfClosing) throw new XmlScanError(`malformed closing tag at offset ${start}`);
      tokens.push({ kind: 'close', raw, name, offset: start });
    } else {
      tokens.push({ kind: 'open', raw, name, selfClosing, offset: start });
    }
    i = j;
  }
  return tokens;
}

interface XmlElement {
  type: 'element';
  open: string;
  name: string;
  children: XmlNode[];
  close: string | null;
  void: boolean;
}
interface XmlLeaf {
  type: 'pi' | 'comment' | 'cdata' | 'doctype' | 'text';
  raw: string;
}
type XmlNode = XmlElement | XmlLeaf;

function buildXmlTree(tokens: XmlToken[], sourceLength: number): XmlNode[] {
  const root: XmlNode[] = [];
  const stack: { name: string; el: XmlElement | null; children: XmlNode[] }[] = [
    { name: '', el: null, children: root },
  ];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.kind === 'open') {
      const isVoid = VOID_ELEMENTS.has(t.name.toLowerCase());
      const el: XmlElement = {
        type: 'element',
        open: t.raw,
        name: t.name,
        children: [],
        close: null,
        void: t.selfClosing || isVoid,
      };
      top.children.push(el);
      if (!(t.selfClosing || isVoid)) stack.push({ name: t.name, el, children: el.children });
    } else if (t.kind === 'close') {
      if (stack.length <= 1) {
        throw new XmlScanError(
          `closing tag </${t.name}> at offset ${t.offset} has no matching opener`,
        );
      }
      const entry = stack[stack.length - 1];
      if (entry.name !== t.name) {
        throw new XmlScanError(
          `expected a closing tag for <${entry.name}>, found </${t.name}> at offset ${t.offset}`,
        );
      }
      if (entry.el) entry.el.close = t.raw;
      stack.pop();
    } else {
      top.children.push({ type: t.kind, raw: t.raw });
    }
  }
  if (stack.length !== 1) {
    throw new XmlScanError(
      `unclosed tag <${stack[stack.length - 1].name}> at offset ${sourceLength}`,
    );
  }
  return root;
}

function tryParseXml(text: string): { ok: true; nodes: XmlNode[] } | { ok: false; reason: string } {
  try {
    const tokens = tokenizeXml(text);
    const nodes = buildXmlTree(tokens, text.length);
    return { ok: true, nodes };
  } catch (err) {
    if (err instanceof XmlScanError) return { ok: false, reason: err.reason };
    throw err;
  }
}

/** Used by detect.ts's `xml` gate (§5b): true only when every tag balances. */
export function scanXml(text: string): { ok: boolean } {
  return { ok: tryParseXml(text).ok };
}

function isWhitespaceOnlyXmlText(s: string): boolean {
  return /^[ \t\r\n]*$/.test(s);
}

function collectXmlIndentedLines(nodes: XmlNode[], depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth);
  for (const node of nodes) {
    if (node.type === 'text') {
      if (isWhitespaceOnlyXmlText(node.raw)) continue;
      lines.push(pad + node.raw.trim());
      continue;
    }
    if (node.type === 'element') {
      lines.push(pad + node.open);
      if (!node.void) {
        collectXmlIndentedLines(node.children, depth + 1, lines);
        lines.push(pad + (node.close ?? ''));
      }
      continue;
    }
    lines.push(pad + node.raw);
  }
}

function renderXmlCompact(nodes: XmlNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (isWhitespaceOnlyXmlText(node.raw)) continue;
      out.push(node.raw);
      continue;
    }
    if (node.type === 'element') {
      out.push(node.open);
      if (!node.void) {
        renderXmlCompact(node.children, out);
        out.push(node.close ?? '');
      }
      continue;
    }
    out.push(node.raw);
  }
}

function beautifyXml(text: string, mode: BeautifyMode): BeautifyResult {
  const r = tryParseXml(text);
  if (!r.ok) return { text, ok: false, reason: r.reason };
  if (mode === 'indented') {
    const lines: string[] = [];
    collectXmlIndentedLines(r.nodes, 0, lines);
    return { text: lines.join('\n'), ok: true };
  }
  const out: string[] = [];
  renderXmlCompact(r.nodes, out);
  return { text: out.join(''), ok: true };
}

// ---------------------------------------------------------------------------------------------

/**
 * Applied to whatever `text` the caller passes in — CellEditorView.vue passes the *current
 * buffer* (P24 D21), so hand-editing then beautifying formats the edit instead of discarding it.
 * Reversibility (indented <-> compact) comes from both modes being lossless, not from always
 * starting over at the stored value; Reset still restores the stored value outright regardless.
 * Offered for `json` and `xml` only (D11); every other format has no lossless formatter and the
 * caller must not invoke this for one (see `canBeautify` in formats.ts).
 */
export function beautify(text: string, format: CellFormat, mode: BeautifyMode): BeautifyResult {
  if (format === 'json') return beautifyJson(text, mode);
  if (format === 'xml') return beautifyXml(text, mode);
  return { text, ok: false, reason: `${format} has no lossless formatter` };
}
