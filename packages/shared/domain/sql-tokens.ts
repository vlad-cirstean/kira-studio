// P60b D1: the SQL parse layer for the query console's language service (completion, diagnostics,
// hover, the DDL extractor) — a third sibling of sql-split.ts/sql-lint.ts, not a new dependency
// (§2's library survey: no candidate covers all five dialects this app supports with the required
// error tolerance, byte-accurate offsets and MIT-compatible license — sql-parser-cst is the best
// technical fit but GPL-2.0-or-later, declined on distribution grounds). Produces exactly the
// shallow tree shape `views/console/lezerNodes.ts` used to get from `@codemirror/lang-sql`:
// `Statement` nodes, each a flat sibling list of tokens with exactly two groupings (`Parens`,
// `CompositeIdentifier`) — every real grammar rule lives in `ddl.ts`/`sqlRefs.ts`, unchanged; this
// file only supplies the tokenizer + those two groupings.
import { type SqlLexOptions, scanSqlSpan } from './sql-lex';

export interface LNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly firstChild: LNode | null;
  readonly nextSibling: LNode | null;
}

// P115 H5: was its own field-by-field copy of SqlLexOptions (a fifth copy of that shape, past
// SqlLexOptions/LintSqlOptions/SplitSqlOptions's own three) — extending it directly also lets
// scanLevel below hand `opts` itself to scanSpanNode, no projected subset object needed.
export interface SqlTokenOptions extends SqlLexOptions {
  /** Case-insensitive; a word in this set tokenises as `Keyword` rather than `Identifier` —
   *  `sql-keywords.ts`'s `keywordsFor(dialect)`. */
  keywords: ReadonlySet<string>;
  /** Which quote character(s) denote a `QuotedIdentifier` rather than a `String` — e.g. `'"'` for
   *  Postgres, `` '`' `` for MySQL, `` '`"' `` for SQLite/ClickHouse (both quote an identifier
   *  there). A quote character not in this string is always a `String`. */
  identifierQuotes: string;
}

// A mutable version of LNode used only while building a level — assigning it to an `LNode`-typed
// field afterwards is safe (readonly only restricts writes through that reference, not the source
// type), so no cast is needed once a node is handed to a caller.
interface MNode {
  name: string;
  from: number;
  to: number;
  firstChild: LNode | null;
  nextSibling: LNode | null;
}

function leaf(name: string, from: number, to: number): MNode {
  return { name, from, to, firstChild: null, nextSibling: null };
}

/** Links `children` into a sibling chain and wraps them under one node named `name`. */
function group(name: string, from: number, to: number, children: readonly MNode[]): MNode {
  for (let i = 0; i < children.length - 1; i++) {
    const child = children[i];
    const next = children[i + 1];
    if (child && next) child.nextSibling = next;
  }
  return { name, from, to, firstChild: children[0] ?? null, nextSibling: null };
}

const NAME_KINDS = new Set(['Identifier', 'QuotedIdentifier', 'Keyword']);

// §3.2 pass 1: any maximal run `name ('.' name)+` becomes one CompositeIdentifier, children being
// the name nodes and the literal '.' nodes in order (splitComposite/sqlDiagnostics.ts both depend
// on that exact shape). Applied once per flat token level — both the root statement list and every
// Parens' own children — since a qualified reference can appear inside a parenthesised expression
// too (sqlRefs.ts's deepCompositeIdentifiers walks "anywhere under node, including inside nested
// Parens").
function groupComposite(nodes: readonly MNode[]): MNode[] {
  const out: MNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const dot = nodes[i + 1];
    const nextName = nodes[i + 2];
    if (
      node &&
      NAME_KINDS.has(node.name) &&
      dot?.name === '.' &&
      nextName &&
      NAME_KINDS.has(nextName.name)
    ) {
      const parts: MNode[] = [node, dot, nextName];
      let j = i + 3;
      for (;;) {
        const nextDot = nodes[j];
        const nextSeg = nodes[j + 1];
        if (nextDot?.name === '.' && nextSeg && NAME_KINDS.has(nextSeg.name)) {
          parts.push(nextDot, nextSeg);
          j += 2;
          continue;
        }
        break;
      }
      const first = parts[0] as MNode;
      const last = parts[parts.length - 1] as MNode;
      out.push(group('CompositeIdentifier', first.from, last.to, parts));
      i = j;
      continue;
    }
    if (node) out.push(node);
    i++;
  }
  return out;
}

// §3.2 pass 2: split a (already composite-grouped) flat token list into Statement nodes on
// top-level ';' — never inside a Parens/String/comment, which the scanner has already resolved by
// construction (a ';' inside any of those was consumed as part of that span, never emitted as its
// own token). The terminating ';' is included as the Statement's own last child (ddl.ts/sqlRefs.ts
// both filter it back out); empty runs (no tokens between two ';'s, or leading/trailing
// whitespace-only) emit no Statement.
function groupStatements(nodes: readonly MNode[]): MNode[] {
  const statements: MNode[] = [];
  let current: MNode[] = [];
  for (const node of nodes) {
    if (node.name === ';') {
      // Empty runs emit no Statement — "empty" means no real content before this terminator, the
      // terminator itself never counts (mirrors sql-split.ts's own pushIfNonEmpty, which slices
      // only up to the ';', excluding it).
      if (current.length > 0) {
        const first = current[0] as MNode;
        const withSemi = [...current, node];
        statements.push(group('Statement', first.from, node.to, withSemi));
      }
      current = [];
      continue;
    }
    current.push(node);
  }
  if (current.length > 0) {
    const first = current[0] as MNode;
    const last = current[current.length - 1] as MNode;
    statements.push(group('Statement', first.from, last.to, current));
  }
  return statements;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

function isNonAscii(c: string): boolean {
  const code = c.codePointAt(0);
  return code !== undefined && code > 127;
}

// M7 finding #18: charCodeAt range checks in place of a fresh regex test per character — this
// scanner calls these once per source character, so the regex engine's own per-call overhead
// (construction of a match state, even for one character) added up across a large document.
function isIdentStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95) return true; // A-Z a-z _
  return isNonAscii(c);
}

function isIdentPart(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  if (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36 // $
  )
    return true;
  return isNonAscii(c);
}

// Same character set `\s` matches (ASCII + the Unicode space separators/line terminators/BOM),
// as charCodeAt range checks — this scanner calls it once per source character.
function isWhitespace(c: string): boolean {
  const code = c.charCodeAt(0);
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x0c ||
    code === 0x0b ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

// digits, `1.5`, `1e6`/`1e-6`, `0x…`.
function scanNumberEnd(source: string, start: number): number {
  const n = source.length;
  let i = start;
  if (source[i] === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
    i += 2;
    while (i < n && /[0-9a-fA-F]/.test(source[i] as string)) i++;
    return i;
  }
  while (i < n && isDigit(source[i])) i++;
  if (source[i] === '.' && isDigit(source[i + 1])) {
    i++;
    while (i < n && isDigit(source[i])) i++;
  }
  if (source[i] === 'e' || source[i] === 'E') {
    let j = i + 1;
    if (source[j] === '+' || source[j] === '-') j++;
    if (isDigit(source[j])) {
      i = j;
      while (i < n && isDigit(source[i])) i++;
    }
  }
  return i;
}

// Sticky (`y`), not `^`-anchored: `lastIndex` positions the match at `i` directly, so scanLevel
// below tests in place with no per-call `source.slice(i)` allocation (M7 finding #18).
const OPERATOR_RE = /[=<>+\-*/%|!]+/y;

/** P94 pass 3 §4.3: one of `scanLevel`'s nine character-class branches, lifted out so its own
 *  branching (the `null`/keyword/identifier three-way classification, past `scanNumberEnd`'s
 *  existing helper) doesn't nest inside scanLevel's own while+if. */
function scanNumberToken(source: string, i: number): { node: MNode; next: number } {
  const end = scanNumberEnd(source, i);
  return { node: leaf('Number', i, end), next: end };
}

function scanIdentifierToken(
  source: string,
  i: number,
  n: number,
  keywords: ReadonlySet<string>,
): { node: MNode; next: number } {
  const start = i;
  let j = i + 1;
  while (j < n && isIdentPart(source[j])) j++;
  const word = source.slice(start, j);
  const lower = word.toLowerCase();
  const name = lower === 'null' ? 'Null' : keywords.has(lower) ? 'Keyword' : 'Identifier';
  return { node: leaf(name, start, j), next: j };
}

function scanOperatorToken(source: string, i: number): { node: MNode; next: number } | null {
  OPERATOR_RE.lastIndex = i;
  const opMatch = OPERATOR_RE.exec(source);
  if (!opMatch) return null;
  return { node: leaf('Operator', i, i + opMatch[0].length), next: i + opMatch[0].length };
}

/** `scanSqlSpan`'s three outcomes, folded into scanLevel's own vocabulary: no span here (`null`),
 *  a comment (dropped — `node: null`, `next` still advances), or a quote/dollar-quote (a leaf
 *  node). Lifted out so the comment-vs-quote branch and the QuotedIdentifier/String ternary don't
 *  nest inside scanLevel's own while+if. */
function scanSpanNode(
  source: string,
  i: number,
  lexOptions: SqlLexOptions,
  identifierQuotes: string,
): { node: MNode | null; next: number } | null {
  const span = scanSqlSpan(source, i, lexOptions);
  if (!span) return null;
  // Comments are trivia, not structure — dropped here exactly like whitespace, never a sibling in
  // any parent's children list. This is what lets a header comment sit ahead of a real statement
  // (a pg_dump preamble's own shape) without derailing `ddl.ts`'s `TokenCursor`, which always
  // expects its very first token to be the statement's own leading keyword — the same "comments
  // are noise… dropped" rule `ddl.ts`'s own `parseColumnDefs` already states for a column list's
  // comments, generalised to every level rather than one.
  if (span.kind === 'lineComment' || span.kind === 'blockComment') {
    return { node: null, next: span.end };
  }
  // P108 Part 11 F4: a bracket-quoted identifier has no `quoteChar` (it isn't one of the
  // `'`/`"`/`` ` `` runs `quoteChar` distinguishes) — always a QuotedIdentifier, never String.
  if (span.kind === 'bracketIdent') {
    return { node: leaf('QuotedIdentifier', span.start, span.end), next: span.end };
  }
  const name =
    span.quoteChar && identifierQuotes.includes(span.quoteChar) ? 'QuotedIdentifier' : 'String';
  return { node: leaf(name, span.start, span.end), next: span.end };
}

/** A `(` and everything up to its matching `)` (or EOF, R2: never throws) — the recursive call
 *  into `scanLevel` is the stack. Lifted out of `scanLevel` itself so the recursion and its own
 *  "was there really a closing paren" check don't nest inside scanLevel's own while+if. */
function scanParenGroup(
  source: string,
  i: number,
  n: number,
  opts: SqlTokenOptions,
): { node: MNode; next: number } {
  const inner = scanLevel(source, i + 1, n, opts, true);
  const groupedInner = groupComposite(inner.nodes);
  const children: MNode[] = [leaf('(', i, i + 1), ...groupedInner];
  let to = inner.next;
  if (source[inner.next] === ')') {
    children.push(leaf(')', inner.next, inner.next + 1));
    to = inner.next + 1;
  }
  return { node: group('Parens', i, to, children), next: to };
}

// One flat level of tokens (the root document, or a Parens' own contents) — a Parens is produced
// here directly (nested via a normal recursive call, not a caller-managed stack — the recursion is
// the stack), balanced or, at EOF, an unterminated one ending at the source length (R2: never
// throws). `stopIndex` bounds the level from outer callers that already consumed a partner ')' —
// unused at the root, where any stray ')' is tolerated as ordinary Punctuation.
function scanLevel(
  source: string,
  start: number,
  n: number,
  opts: SqlTokenOptions,
  insideParens: boolean,
): { nodes: MNode[]; next: number } {
  const nodes: MNode[] = [];
  let i = start;

  while (i < n) {
    const c = source[i] as string;

    if (insideParens && c === ')') return { nodes, next: i };

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    const spanToken = scanSpanNode(source, i, opts, opts.identifierQuotes);
    if (spanToken) {
      if (spanToken.node) nodes.push(spanToken.node);
      i = spanToken.next;
      continue;
    }

    if (c === '(') {
      const t = scanParenGroup(source, i, n, opts);
      nodes.push(t.node);
      i = t.next;
      continue;
    }
    if (c === ')') {
      // Not inside a Parens level we're tracking (an unmatched close, or the root) — R2 never
      // throws; sql-lint.ts's own paren scan is what flags this as a defect.
      nodes.push(leaf('Punctuation', i, i + 1));
      i++;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1]))) {
      const t = scanNumberToken(source, i);
      nodes.push(t.node);
      i = t.next;
      continue;
    }

    if (isIdentStart(c)) {
      const t = scanIdentifierToken(source, i, n, opts.keywords);
      nodes.push(t.node);
      i = t.next;
      continue;
    }

    if (c === ';') {
      nodes.push(leaf(';', i, i + 1));
      i++;
      continue;
    }
    if (c === '.') {
      nodes.push(leaf('.', i, i + 1));
      i++;
      continue;
    }

    const opToken = scanOperatorToken(source, i);
    if (opToken) {
      nodes.push(opToken.node);
      i = opToken.next;
      continue;
    }

    // `,` `:` and any other single separator character.
    nodes.push(leaf('Punctuation', i, i + 1));
    i++;
  }
  return { nodes, next: i };
}

// D2: a module-level memo, key (options, source) both compared by reference, size 2, FIFO —
// several callers (a hover, a lint run, a completion) over the same untouched document string
// share one tokenize, restoring the perf fix `editor/hover.ts`'s old `syntaxTree(view.state)`
// handoff existed for (up to ~51ms on a 191KB document, over budget with no debounce). Works
// because `sqlNodes.ts`'s `tokenOptionsFor(dialect)` memoises its own return value per dialect, so
// repeated calls for the same dialect hand back the identical `SqlTokenOptions` object — the same
// technique `findRanges.ts`'s own `positionCache` and `state/schemas.ts`'s `parsedCache` already
// use for an identical reason (several callers, same immutable string, one keystroke).
const MEMO_SIZE = 2;
const memo: { options: SqlTokenOptions; source: string; root: LNode }[] = [];

export function tokenizeSql(source: string, options: SqlTokenOptions): LNode {
  const cached = memo.find((e) => e.options === options && e.source === source);
  if (cached) return cached.root;

  const n = source.length;
  const level = scanLevel(source, 0, n, options, false);
  const grouped = groupComposite(level.nodes);
  const statements = groupStatements(grouped);
  const root = group('Script', 0, n, statements);

  memo.push({ options, source, root });
  if (memo.length > MEMO_SIZE) memo.shift();
  return root;
}
