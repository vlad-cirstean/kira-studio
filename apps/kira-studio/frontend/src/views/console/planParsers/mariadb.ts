import { isOverThreshold, maxEstimatedRows, pushWideScanIssue, rollupIssues } from '../planIssues';
import type { PlanNode, QueryPlan, ScanEstimate } from '../planModel';

// P18 (v1.1) D13/D15/D16: MariaDB 11.4's `EXPLAIN FORMAT=JSON` — same statement spelling as
// MySQL's, a genuinely different response schema (F13): every table sits inside a `nested_loop`
// array (even a single-table query), wrapped in `read_sorted_file`/`filesort` for a sort and
// (per F13's own prose) `block-nl-join` for a block nested-loop join; the scalar cost field is
// named `cost` (≈ seconds under MariaDB 11.x's model) rather than MySQL's `cost_info.query_cost`,
// and `filtered` is a plain number, not MySQL's string. `FORMAT=TREE` is a hard error on this
// engine (ERROR 1791) — never used.
interface RawTable {
  table_name?: string;
  access_type?: string;
  possible_keys?: string[];
  key?: string;
  key_length?: string;
  used_key_parts?: string[];
  ref?: string[];
  loops?: number;
  rows?: number;
  cost?: number;
  filtered?: number;
  attached_condition?: string;
}

interface NestedLoopEntry {
  table?: RawTable;
  read_sorted_file?: {
    filesort?: { sort_key?: string; table?: RawTable; nested_loop?: NestedLoopEntry[] };
  };
  'block-nl-join'?: { nested_loop?: NestedLoopEntry[]; buffer_type?: string };
}

interface RawBlock {
  cost?: number;
  nested_loop?: NestedLoopEntry[];
}

const TABLE_TYPED_KEYS = new Set([
  'table_name',
  'access_type',
  'possible_keys',
  'key',
  'rows',
  'attached_condition',
]);

function tableMetrics(table: RawTable): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(table)) {
    if (TABLE_TYPED_KEYS.has(key) || value === undefined) continue;
    out.push({ label: key, value: Array.isArray(value) ? value.join(', ') : String(value) });
  }
  return out;
}

function tableLabel(table: RawTable): string {
  const name = table.table_name ?? '?';
  if (table.access_type === 'ALL') return `Full scan on ${name}`;
  if (table.access_type) return `${table.access_type} access on ${name}`;
  return name;
}

function tableNode(table: RawTable, scans: ScanEstimate[]): PlanNode {
  const node: PlanNode = {
    label: tableLabel(table),
    relation: table.table_name,
    detail: table.attached_condition,
    estimatedRows: table.rows,
    cost: table.cost !== undefined ? { total: table.cost } : undefined,
    metrics: tableMetrics(table),
    issues: [],
    children: [],
  };

  // D15: full scan.
  if (table.access_type === 'ALL') {
    node.issues.push({
      severity: 'warn',
      code: 'full-scan',
      message: `full table scan on "${node.relation ?? '?'}" — no index was used`,
    });
  }
  // D15: an index existed and was not chosen.
  if (table.possible_keys && table.possible_keys.length > 0 && !table.key) {
    node.issues.push({
      severity: 'warn',
      code: 'unused-index',
      message: `"${node.relation ?? '?'}" has an index (${table.possible_keys.join(', ')}) the planner did not choose`,
    });
  }

  if (node.estimatedRows !== undefined) scans.push({ node, rows: node.estimatedRows });
  return node;
}

function wrap(label: string, children: PlanNode[], issues: PlanNode['issues'] = []): PlanNode {
  return { label, metrics: [], issues, children };
}

function entryNode(entry: NestedLoopEntry, scans: ScanEstimate[]): PlanNode | null {
  if (entry.table) return tableNode(entry.table, scans);

  // D15: filesort — a read_sorted_file/filesort wrapper node is present.
  const filesort = entry.read_sorted_file?.filesort;
  if (filesort) {
    const child = filesort.table
      ? tableNode(filesort.table, scans)
      : filesort.nested_loop
        ? wrap('Nested loop join', entriesToNodes(filesort.nested_loop, scans))
        : null;
    return wrap('Sort (filesort)', child ? [child] : [], [
      {
        severity: 'warn',
        code: 'filesort',
        message: filesort.sort_key
          ? `a temporary sort file (filesort) was used — sort key ${filesort.sort_key}`
          : 'a temporary sort file (filesort) was used',
      },
    ]);
  }

  const blockJoin = entry['block-nl-join'];
  if (blockJoin?.nested_loop) {
    return wrap('Block nested loop join', entriesToNodes(blockJoin.nested_loop, scans));
  }

  return null;
}

function entriesToNodes(entries: NestedLoopEntry[], scans: ScanEstimate[]): PlanNode[] {
  return entries.map((e) => entryNode(e, scans)).filter((n): n is PlanNode => n !== null);
}

export function parseMariadbPlan(rawText: string, thresholdRows: number): QueryPlan {
  const parsed = JSON.parse(rawText) as { query_block?: RawBlock };
  const block = parsed.query_block ?? {};
  const scans: ScanEstimate[] = [];
  const children = block.nested_loop ? entriesToNodes(block.nested_loop, scans) : [];
  const root: PlanNode = {
    label: 'Query',
    cost: block.cost !== undefined ? { total: block.cost } : undefined,
    metrics: [],
    issues: [],
    children,
  };
  for (const scan of scans) pushWideScanIssue(scan.node, scan.rows, thresholdRows);

  const estimatedRowsRead = maxEstimatedRows(scans);
  return {
    kind: 'mariadb',
    root,
    estimatedRowsRead,
    nativeCost: block.cost !== undefined ? { value: block.cost, unit: 'mariadb-cost' } : undefined,
    issues: rollupIssues(root),
    overThreshold: isOverThreshold(estimatedRowsRead, thresholdRows),
    raw: rawText,
  };
}
