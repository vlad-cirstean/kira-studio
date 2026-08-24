// The row model the virtualized document list reads: one memoized parse per page row, the
// per-path expansion set, and the exact row height. Plain Maps/Sets keyed by row and by path —
// never reactive (§0, D21) — with `rowsVersion` as the one reactive surface, mirroring docPage.ts's
// own `pageVersion`. A `reactive()` tree here would put a Proxy around every node of every document
// on the page, which is exactly the frame budget this phase exists to protect.
import { reactive } from 'vue';
import { formatBytes } from '../../format';
import { documentRow } from './docPage';
import { type BsonType, type DocNode, parseDocument, parseIdLabel } from './ejson';

export interface DocumentRowView {
  index: number;
  /** The raw EJSON id text — the mutation key, unchanged. */
  id: string;
  /** parseIdLabel().text — what the head shows and Copy _id copies. */
  idLabel: string;
  idType: BsonType;
  /** '7 fields' (F8's mockup badge). */
  fieldCount: number;
  byteLabel: string;
  isTruncated: boolean;
  /** null => D22's raw-text fallback. */
  root: DocNode | null;
}

export interface DocLine {
  node: DocNode;
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

interface Parsed {
  root: DocNode | null;
  idLabel: string;
  idType: BsonType;
  byteLabel: string;
}

interface TabRows {
  parseCache: Map<number, Parsed>;
  expandedPaths: Map<number, Set<string>>;
}

const tabRows = new Map<string, TabRows>();
const byteEncoder = new TextEncoder();

/** The only reactive thing in this module — bumped on every parse-cache/expansion-set change. */
export const rowsVersion = reactive({ n: 0 });

function ensureTabRows(tabId: string): TabRows {
  let entry = tabRows.get(tabId);
  if (!entry) {
    entry = { parseCache: new Map(), expandedPaths: new Map() };
    tabRows.set(tabId, entry);
  }
  return entry;
}

function parseRow(tabId: string, row: number): Parsed | null {
  const doc = documentRow(tabId, row);
  if (!doc) return null;
  const entry = ensureTabRows(tabId);
  const cached = entry.parseCache.get(row);
  if (cached) return cached;
  const idLabel = parseIdLabel(doc.id);
  const parsed: Parsed = {
    root: parseDocument(doc.body),
    idLabel: idLabel.text,
    idType: idLabel.bsonType,
    byteLabel: formatBytes(byteEncoder.encode(doc.body).length),
  };
  entry.parseCache.set(row, parsed);
  return parsed;
}

export function rowView(tabId: string, row: number): DocumentRowView | null {
  const doc = documentRow(tabId, row);
  const parsed = parseRow(tabId, row);
  if (!doc || !parsed) return null;
  return {
    index: row,
    id: doc.id,
    idLabel: parsed.idLabel,
    idType: parsed.idType,
    fieldCount: parsed.root ? parsed.root.children.length : 0,
    byteLabel: parsed.byteLabel,
    isTruncated: doc.isTruncated,
    root: parsed.root,
  };
}

function expandedPathsFor(tabId: string, row: number): Set<string> {
  const entry = ensureTabRows(tabId);
  let set = entry.expandedPaths.get(row);
  if (!set) {
    set = new Set();
    entry.expandedPaths.set(row, set);
  }
  return set;
}

export function isPathExpanded(tabId: string, row: number, path: string): boolean {
  return expandedPathsFor(tabId, row).has(path);
}

export function togglePath(tabId: string, row: number, path: string): void {
  const set = expandedPathsFor(tabId, row);
  if (set.has(path)) set.delete(path);
  else set.add(path);
  rowsVersion.n++;
}

function walk(tabId: string, row: number, node: DocNode, depth: number, out: DocLine[]): void {
  for (const child of node.children) {
    const expandable = child.kind !== 'scalar';
    const expanded = expandable && isPathExpanded(tabId, row, child.path);
    out.push({ node: child, depth, expandable, expanded });
    if (expanded) walk(tabId, row, child, depth + 1, out);
  }
}

/**
 * Ascending, flattened, exactly what the expanded body renders: the first layer always, plus the
 * descendants of every path in the expansion set. `depth` drives the indent.
 */
export function visibleLines(tabId: string, row: number): readonly DocLine[] {
  const parsed = parseRow(tabId, row);
  if (!parsed?.root) return [];
  const out: DocLine[] = [];
  walk(tabId, row, parsed.root, 0, out);
  return out;
}

/** Called from `state.ts`'s `load()` after `setPage` — a new page has new rows; every parse and
 *  every path is stale. */
export function resetRows(tabId: string): void {
  const entry = tabRows.get(tabId);
  if (entry) {
    entry.parseCache.clear();
    entry.expandedPaths.clear();
  }
  rowsVersion.n++;
}

const HEAD_H = 26; // --kira-h-md
const LINE_H = 18; // --kira-h-xs, OperationsPanel's own row height
const BODY_PADDING_V = 8; // --kira-s-2 top + bottom, DocumentTree.vue's own body padding
const EDITING_H = 220; // the fixed editor panel height (unchanged from the pre-P27 row)

/**
 * The exact pixel height of row `i`, with no measurement (D20): a head plus, when expanded, one
 * line per visible node — or the fixed editor height while this row is the one being edited, or
 * while it fell back to raw text (D22 — an arbitrarily wrapped `<pre>` isn't exactly measurable
 * either, so it gets the same fixed allowance rather than a false claim of precision).
 *
 * `isExpanded` is supplied by the caller (state.ts's `isDocumentExpanded`) rather than looked up
 * here — this module and state.ts would otherwise import each other (docPage.ts already does,
 * below, for `resetRows`), and one circular edge is enough.
 */
export function rowHeight(
  tabId: string,
  row: number,
  editingId: string | null,
  isExpanded: boolean,
): number {
  const doc = documentRow(tabId, row);
  if (!doc) return HEAD_H;
  if (doc.id === editingId) return HEAD_H + EDITING_H;
  if (!isExpanded) return HEAD_H;
  const parsed = parseRow(tabId, row);
  if (!parsed?.root) return HEAD_H + EDITING_H;
  const lines = visibleLines(tabId, row).length;
  return HEAD_H + lines * LINE_H + BODY_PADDING_V;
}
