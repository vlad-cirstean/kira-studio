import type { SQLDialect } from '@codemirror/lang-sql';
import {
  childrenOf,
  isKeyword,
  isNameNode,
  type LNode,
  splitComposite,
  text,
  unquotedName,
} from './lezerNodes';

// P18 (v1.1) D7/D8: a from-scratch re-derivation of lang-sql's own getAliases (F2) — a table
// reference and its optional alias, walked from each statement's FROM/JOIN clause over the exact
// same flat token stream the DDL extractor (ddl.ts) reads. Shared by sqlDiagnostics.ts (unknown
// relation / unknown qualified column) and sqlHover.ts (resolving `alias.column` under the
// cursor), so there is exactly one alias walker in the app, not two that can drift apart.
export interface TableRef {
  schema?: string;
  name: string;
  alias?: string;
  /** The exact node this ref's own name token came from — used to exclude it from the deep
   *  CompositeIdentifier scan diagnostics run (a FROM clause's `schema.table` is not a
   *  `table.column` reference). */
  nodeFrom: number;
}

export interface StatementRefs {
  statement: LNode;
  refs: TableRef[];
  /** Names declared by a leading `WITH … AS (…)` clause — exempt from "unknown relation" (D7). */
  cteNames: Set<string>;
}

// F2: the keywords getAliases stops an alias scan at.
const END_FROM = new Set([
  'where',
  'group',
  'having',
  'order',
  'union',
  'intersect',
  'except',
  'all',
  'distinct',
  'limit',
  'offset',
  'fetch',
  'for',
]);

function collectCteNames(toks: readonly LNode[], source: string): Set<string> {
  const names = new Set<string>();
  if (!isKeyword(toks[0], 'with', source)) return names;
  let i = 1;
  if (isKeyword(toks[i], 'recursive', source)) i++;
  for (;;) {
    const nameNode = toks[i];
    if (!nameNode || !isNameNode(nameNode)) break;
    names.add(unquotedName(nameNode, source).toLowerCase());
    i++;
    if (toks[i]?.name === 'Parens') i++; // an explicit column list before AS
    if (!isKeyword(toks[i], 'as', source)) break;
    i++;
    if (toks[i]?.name !== 'Parens') break;
    i++;
    if (toks[i]?.name === 'Punctuation' && text(toks[i] as LNode, source) === ',') {
      i++;
      continue;
    }
    break;
  }
  return names;
}

// One table reference at toks[i]: `[schema.]name [[AS] alias]`, or a table-valued function call
// (`name(...)`, no ref emitted) — returns the number of tokens consumed, always >= 1.
function readOneRef(
  toks: readonly LNode[],
  i: number,
  source: string,
): { ref?: TableRef; consumed: number } {
  const nameNode = toks[i];
  if (!nameNode) return { consumed: 1 };
  let schema: string | undefined;
  let name: string;
  if (nameNode.name === 'CompositeIdentifier') {
    const segs = splitComposite(nameNode, source);
    if (segs.length === 0) return { consumed: 1 };
    name = segs[segs.length - 1] as string;
    schema = segs.length > 1 ? segs[segs.length - 2] : undefined;
  } else if (isNameNode(nameNode)) {
    name = unquotedName(nameNode, source);
  } else {
    return { consumed: 1 };
  }

  // A table-valued function call, e.g. `FROM generate_series(1, 10)` — not a relation to resolve.
  if (toks[i + 1]?.name === 'Parens') return { consumed: 2 };

  if (isKeyword(toks[i + 1], 'as', source) && toks[i + 2] && isNameNode(toks[i + 2] as LNode)) {
    const alias = unquotedName(toks[i + 2] as LNode, source);
    return { ref: { schema, name, alias, nodeFrom: nameNode.from }, consumed: 3 };
  }
  const next = toks[i + 1];
  if (next && isNameNode(next)) {
    return {
      ref: { schema, name, alias: unquotedName(next, source), nodeFrom: nameNode.from },
      consumed: 2,
    };
  }
  return { ref: { schema, name, nodeFrom: nameNode.from }, consumed: 1 };
}

function refsInStatement(toks: readonly LNode[], source: string): TableRef[] {
  const refs: TableRef[] = [];
  let i = toks.findIndex((t) => isKeyword(t, 'from', source));
  if (i < 0) return refs;
  i++;
  const joinStart = new Set(['join', 'left', 'right', 'inner', 'full', 'cross', 'natural']);
  while (i < toks.length) {
    const t = toks[i] as LNode;
    const w = t.name === 'Keyword' ? text(t, source).toLowerCase() : undefined;
    if (w !== undefined && END_FROM.has(w)) break;
    if (w === 'on') {
      // Skip the join condition entirely — its own qualified identifiers are not table refs.
      i++;
      while (i < toks.length) {
        const u = toks[i] as LNode;
        const uw = u.name === 'Keyword' ? text(u, source).toLowerCase() : undefined;
        if (uw !== undefined && (joinStart.has(uw) || END_FROM.has(uw))) break;
        i++;
      }
      continue;
    }
    if (w !== undefined && (joinStart.has(w) || w === 'using')) {
      i++;
      continue;
    }
    if (t.name === 'Punctuation' && text(t, source) === ',') {
      i++;
      continue;
    }
    if (isNameNode(t) || t.name === 'CompositeIdentifier') {
      const { ref, consumed } = readOneRef(toks, i, source);
      if (ref) refs.push(ref);
      i += consumed;
      continue;
    }
    i++;
  }
  return refs;
}

/** Every top-level Statement in `source`, with its FROM/JOIN table refs and any WITH-declared CTE
 *  names. Subqueries are not walked — this is a best-effort binder, not a real one (D7's own
 *  false-positive rule: under-detect rather than guess). */
// `root` lets a caller that has already parsed `source` (sqlHover.ts's resolveHover, P12 round 1
// finding #13) pass the tree through instead of paying for a second, redundant parse of the exact
// same string — measured ~5-13ms per hover on a moderately large script, half of it provably
// redundant. Omitted, this parses `source` itself, unchanged from before.
export function statementsWithRefs(
  dialect: SQLDialect,
  source: string,
  root?: LNode,
): StatementRefs[] {
  const parsedRoot = root ?? (dialect.language.parser.parse(source).topNode as unknown as LNode);
  const out: StatementRefs[] = [];
  for (const stmt of childrenOf(parsedRoot)) {
    if (stmt.name !== 'Statement') continue;
    const toks = childrenOf(stmt).filter((n) => n.name !== ';');
    out.push({
      statement: stmt,
      refs: refsInStatement(toks, source),
      cteNames: collectCteNames(toks, source),
    });
  }
  return out;
}

/** Every CompositeIdentifier node anywhere under `node` (including inside nested Parens) —
 *  candidate `alias.column`/`table.column` references for D7's unknown-qualified-column rule and
 *  D8's hover resolution. */
export function deepCompositeIdentifiers(node: LNode): LNode[] {
  const out: LNode[] = [];
  const walk = (n: LNode): void => {
    if (n.name === 'CompositeIdentifier') out.push(n);
    for (const child of childrenOf(n)) walk(child);
  };
  for (const child of childrenOf(node)) walk(child);
  return out;
}
