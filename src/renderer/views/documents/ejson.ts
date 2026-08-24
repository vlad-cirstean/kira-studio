// Parses one document body — canonical extended JSON, `read.ts`'s `EJSON.stringify(doc, {relaxed:
// false})` — into a plain, frozen, non-reactive node tree, and formats values back out in Mongo
// shell form. No `bson` import: every BSON wrapper is recognised by shape against the closed EJSON
// v2 spec (P27 D13) — the renderer never parses a wire protocol.
//
// A canonical numeric wrapper's own value is always a JSON *string* (`{"$numberLong":"123"}`), so
// `JSON.parse` never rounds a BSON integer through a lossy JS `number` the way it would for the SQL
// cell editor's raw numeric literals (`beautify.ts`'s reason for a hand-written scanner there) —
// plain `JSON.parse` is exact here.

export type DocNodeKind = 'object' | 'array' | 'scalar';

/** The BSON type a node resolved to, for the type tooltip and the ObjectId/date affordances.
 *  'json' means a plain JSON scalar with no extended-JSON wrapper around it. */
export type BsonType =
  | 'json'
  | 'ObjectId'
  | 'Date'
  | 'Int32'
  | 'Int64'
  | 'Double'
  | 'Decimal128'
  | 'Binary'
  | 'Timestamp'
  | 'RegExp'
  | 'Code'
  | 'DBRef'
  | 'MinKey'
  | 'MaxKey'
  | 'UUID';

export interface DocNode {
  /** Field name, or the index as text inside an array. '' for the root. */
  key: string;
  /** Dotted path from the root ('device.os', 'tags.0'); '' for the root. Identity for the per-path
   *  expansion set (documentRows.ts D4) — stable across a re-parse of the same body. */
  path: string;
  kind: DocNodeKind;
  /** scalar only: the rendered text — `ObjectId("507f…")`, `"active"`, `148`, `null`. */
  text: string;
  /** scalar only: which --kira-syntax-* colour the text takes. */
  token: 'string' | 'number' | 'keyword' | 'bson';
  bsonType: BsonType;
  /** object/array only. Frozen. */
  children: readonly DocNode[];
  /** object/array only: '{…} 3 fields' / '[…] 12 items' — what a collapsed container shows. */
  summary: string;
}

interface ScalarRender {
  text: string;
  token: DocNode['token'];
  bsonType: BsonType;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

// One canonical millis value out of a $date wrapper: usually a nested {"$numberLong": "..."}
// (what this app's own EJSON.stringify({relaxed:false}) always writes), tolerating a bare
// ISO/millis string in case a document was written by some other tool.
function dateMillis(value: unknown): number | null {
  if (
    isPlainObject(value) &&
    objectKeys(value).length === 1 &&
    typeof value.$numberLong === 'string'
  ) {
    const n = Number(value.$numberLong);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string') {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'number') return value;
  return null;
}

/**
 * Recognises a single-purpose EJSON wrapper object by shape and renders its shell text. Returns
 * `null` for a plain object (no known wrapper key). The six types `literal.ts` can construct
 * (ObjectId, ISODate/Date, NumberLong, NumberInt, NumberDecimal) render as constructor calls;
 * Double renders as a bare number, since typing a bare number into the shell already produces one;
 * every other BSON type falls back to its canonical EJSON text verbatim (D14) — round-trippable
 * through `resolveEjsonWrappers`, just not spelled as a constructor this app doesn't offer.
 */
function detectWrapper(value: Record<string, unknown>): ScalarRender | null {
  const keys = objectKeys(value);

  if (keys.length === 1 && keys[0] === '$oid' && typeof value.$oid === 'string') {
    return { text: `ObjectId("${value.$oid}")`, token: 'bson', bsonType: 'ObjectId' };
  }
  if (keys.length === 1 && keys[0] === '$date') {
    const millis = dateMillis(value.$date);
    if (millis !== null) {
      return {
        text: `ISODate("${new Date(millis).toISOString()}")`,
        token: 'bson',
        bsonType: 'Date',
      };
    }
  }
  if (keys.length === 1 && keys[0] === '$numberInt' && typeof value.$numberInt === 'string') {
    return { text: `NumberInt(${value.$numberInt})`, token: 'bson', bsonType: 'Int32' };
  }
  if (keys.length === 1 && keys[0] === '$numberLong' && typeof value.$numberLong === 'string') {
    return {
      text: `NumberLong("${value.$numberLong}")`,
      token: 'bson',
      bsonType: 'Int64',
    };
  }
  if (
    keys.length === 1 &&
    keys[0] === '$numberDecimal' &&
    typeof value.$numberDecimal === 'string'
  ) {
    return {
      text: `NumberDecimal("${value.$numberDecimal}")`,
      token: 'bson',
      bsonType: 'Decimal128',
    };
  }
  if (keys.length === 1 && keys[0] === '$numberDouble' && typeof value.$numberDouble === 'string') {
    const raw = value.$numberDouble;
    // Infinity/-Infinity/NaN have no bare-number JSON spelling — fall through to the verbatim
    // fallback below rather than emitting text `parseDocumentLiteral` cannot re-tokenize.
    if (Number.isFinite(Number(raw))) {
      return { text: raw, token: 'number', bsonType: 'Double' };
    }
  }
  if (
    keys.length === 1 &&
    keys[0] === '$binary' &&
    isPlainObject(value.$binary) &&
    typeof value.$binary.base64 === 'string' &&
    typeof value.$binary.subType === 'string'
  ) {
    const isUuid = value.$binary.subType.toLowerCase() === '04';
    return {
      text: JSON.stringify(value),
      token: 'bson',
      bsonType: isUuid ? 'UUID' : 'Binary',
    };
  }
  if (
    keys.length === 1 &&
    keys[0] === '$timestamp' &&
    isPlainObject(value.$timestamp) &&
    typeof value.$timestamp.t === 'number' &&
    typeof value.$timestamp.i === 'number'
  ) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'Timestamp' };
  }
  if (
    keys.length === 1 &&
    keys[0] === '$regularExpression' &&
    isPlainObject(value.$regularExpression) &&
    typeof value.$regularExpression.pattern === 'string'
  ) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'RegExp' };
  }
  if (
    (keys.length === 1 || keys.length === 2) &&
    keys.includes('$code') &&
    typeof value.$code === 'string' &&
    keys.every((k) => k === '$code' || k === '$scope')
  ) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'Code' };
  }
  if (
    keys.includes('$ref') &&
    keys.includes('$id') &&
    typeof value.$ref === 'string' &&
    keys.every((k) => k === '$ref' || k === '$id' || k === '$db')
  ) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'DBRef' };
  }
  if (keys.length === 1 && keys[0] === '$minKey' && value.$minKey === 1) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'MinKey' };
  }
  if (keys.length === 1 && keys[0] === '$maxKey' && value.$maxKey === 1) {
    return { text: JSON.stringify(value), token: 'bson', bsonType: 'MaxKey' };
  }
  return null;
}

function renderScalar(value: string | number | boolean | null): ScalarRender {
  if (value === null) return { text: 'null', token: 'keyword', bsonType: 'json' };
  if (typeof value === 'boolean') {
    return { text: value ? 'true' : 'false', token: 'keyword', bsonType: 'json' };
  }
  if (typeof value === 'string') {
    return { text: JSON.stringify(value), token: 'string', bsonType: 'json' };
  }
  // Canonical EJSON never emits a bare JSON number for a BSON value, but tolerate one anyway
  // (e.g. hand-written test fixtures) rather than throwing.
  return { text: String(value), token: 'number', bsonType: 'json' };
}

function summaryFor(kind: 'object' | 'array', count: number): string {
  if (count === 0) return kind === 'object' ? '{}' : '[]';
  const noun =
    kind === 'object' ? (count === 1 ? 'field' : 'fields') : count === 1 ? 'item' : 'items';
  return kind === 'object' ? `{…} ${count} ${noun}` : `[…] ${count} ${noun}`;
}

function buildNode(value: unknown, key: string, path: string): DocNode {
  if (Array.isArray(value)) {
    const children = value.map((item, i) =>
      buildNode(item, String(i), path === '' ? String(i) : `${path}.${i}`),
    );
    return Object.freeze({
      key,
      path,
      kind: 'array',
      text: '',
      token: 'string',
      bsonType: 'json',
      children: Object.freeze(children),
      summary: summaryFor('array', children.length),
    });
  }
  if (isPlainObject(value)) {
    const wrapper = detectWrapper(value);
    if (wrapper) {
      return Object.freeze({
        key,
        path,
        kind: 'scalar',
        text: wrapper.text,
        token: wrapper.token,
        bsonType: wrapper.bsonType,
        children: Object.freeze([]),
        summary: '',
      });
    }
    const children = objectKeys(value).map((k) =>
      buildNode(value[k], k, path === '' ? k : `${path}.${k}`),
    );
    return Object.freeze({
      key,
      path,
      kind: 'object',
      text: '',
      token: 'string',
      bsonType: 'json',
      children: Object.freeze(children),
      summary: summaryFor('object', children.length),
    });
  }
  const scalar = renderScalar(value as string | number | boolean | null);
  return Object.freeze({
    key,
    path,
    kind: 'scalar',
    text: scalar.text,
    token: scalar.token,
    bsonType: scalar.bsonType,
    children: Object.freeze([]),
    summary: '',
  });
}

/** `null` for a body that is not a parseable JSON object — a truncated one (F3's 64 KB cut) or a
 *  non-object result. The caller falls back to showing the raw text (D22). */
export function parseDocument(body: string): DocNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  // A bare-object body could itself be a recognised wrapper (unlikely for a whole document, but
  // not impossible for a hand-crafted fixture) — buildNode's own object branch already checks
  // detectWrapper before falling back to the field-by-field walk, so this stays one code path.
  return buildNode(parsed, '', '');
}

/** The one-line label for a document's `_id`, from `DocumentPage.ids`' own EJSON text:
 *  '{"$oid":"507f…"}' -> { text: 'ObjectId("507f…")', bsonType: 'ObjectId' }. */
export function parseIdLabel(idEjson: string): { text: string; bsonType: BsonType } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(idEjson);
  } catch {
    return { text: idEjson, bsonType: 'json' };
  }
  if (isPlainObject(parsed)) {
    const wrapper = detectWrapper(parsed);
    if (wrapper) return { text: wrapper.text, bsonType: wrapper.bsonType };
    return { text: JSON.stringify(parsed), bsonType: 'json' };
  }
  const scalar = renderScalar(parsed as string | number | boolean | null);
  return { text: scalar.text, bsonType: scalar.bsonType };
}

const INDENT = '  ';

function shellNodeText(node: DocNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  const padIn = INDENT.repeat(depth + 1);
  if (node.kind === 'scalar') return node.text;
  if (node.kind === 'array') {
    if (node.children.length === 0) return '[]';
    const items = node.children.map((c) => `${padIn}${shellNodeText(c, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (node.children.length === 0) return '{}';
  const members = node.children.map(
    (c) => `${padIn}${JSON.stringify(c.key)}: ${shellNodeText(c, depth + 1)}`,
  );
  return `{\n${members.join(',\n')}\n${pad}}`;
}

/** The editable buffer's text: the document re-serialised as an indented Mongo shell literal —
 *  `ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`, `NumberDecimal("…")`, `NumberInt(…)` for the
 *  six types literal.ts can construct, and the canonical extended-JSON object verbatim for every
 *  other type, so nothing is ever lossy (D14). Falls back to the raw body unchanged when it does
 *  not parse (D22's raw-text case has nothing shell-literal to offer). */
export function toShellText(body: string): string {
  const root = parseDocument(body);
  if (!root) return body;
  return shellNodeText(root, 0);
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** ObjectId's own embedded timestamp, for the type tooltip (F16's NoSQLBooster precedent).
 *  `null` when the hex is not a well-formed 24-character ObjectId. */
export function objectIdCreatedAt(hex: string): Date | null {
  if (!OBJECT_ID_RE.test(hex)) return null;
  const seconds = Number.parseInt(hex.slice(0, 8), 16);
  return new Date(seconds * 1000);
}
