import { isOverThreshold, maxEstimatedRows, pushWideScanIssue, rollupIssues } from '../planIssues';
import type { PlanNode, QueryPlan, ScanEstimate } from '../planModel';

// P18 (v1.1) D13/D15/D16: MySQL 8.4's `EXPLAIN FORMAT=JSON` — F12. One row, one column, a
// `query_block` whose real content sits under `table` (single-table), `nested_loop` (a join —
// same key MariaDB's own JSON uses, but a genuinely different schema underneath it, F13), or a
// wrapping `grouping_operation`/`ordering_operation`/`duplicates_removal` block around either.
// F12's own three examples — a plain table, a materialized derived table, and a sort — are read
// literally below; anything this shape doesn't name is skipped rather than guessed at.
interface RawTable {
  table_name?: string;
  access_type?: string;
  possible_keys?: string[];
  key?: string;
  key_length?: string;
  used_key_parts?: string[];
  ref?: string[];
  rows_examined_per_scan?: number;
  rows_produced_per_join?: number;
  filtered?: string;
  cost_info?: {
    read_cost?: string;
    eval_cost?: string;
    prefix_cost?: string;
    data_read_per_join?: string;
  };
  used_columns?: string[];
  attached_condition?: string;
  using_temporary_table?: boolean;
  using_filesort?: boolean;
  materialized_from_subquery?: { using_temporary_table?: boolean; query_block?: RawBlock };
}

interface RawBlock {
  cost_info?: { query_cost?: string };
  table?: RawTable;
  nested_loop?: Array<{ table?: RawTable }>;
  grouping_operation?: RawBlock;
  ordering_operation?: RawBlock & { using_filesort?: boolean };
  duplicates_removal?: RawBlock;
}

const TABLE_TYPED_KEYS = new Set([
  'table_name',
  'access_type',
  'possible_keys',
  'key',
  'rows_examined_per_scan',
  'attached_condition',
  'materialized_from_subquery',
]);

function tableMetrics(table: RawTable): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(table)) {
    if (TABLE_TYPED_KEYS.has(key) || value === undefined) continue;
    if (key === 'cost_info' && value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out.push({ label: `cost_info.${k}`, value: String(v) });
      }
      continue;
    }
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

function tableNode(table: RawTable, thresholdRows: number, scans: ScanEstimate[]): PlanNode {
  const node: PlanNode = {
    label: tableLabel(table),
    relation: table.table_name,
    detail: table.attached_condition,
    estimatedRows: table.rows_examined_per_scan,
    cost:
      table.cost_info?.prefix_cost !== undefined
        ? { total: Number(table.cost_info.prefix_cost) }
        : undefined,
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
  // D15: filesort, when the flag sits on the table itself rather than an ordering_operation
  // wrapper (both are real shapes — see D15's own table).
  if (table.using_filesort) {
    node.issues.push({
      severity: 'warn',
      code: 'filesort',
      message: `"${node.relation ?? '?'}" was sorted with a temporary file (filesort)`,
    });
  }
  // D15: a derived table materialized into a temp table.
  if (table.using_temporary_table || table.materialized_from_subquery?.using_temporary_table) {
    node.issues.push({
      severity: 'warn',
      code: 'temp-table',
      message: `"${node.relation ?? '?'}" was materialized into a temporary table`,
    });
  }

  const subBlock = table.materialized_from_subquery?.query_block;
  if (subBlock) node.children.push(...blockNodes(subBlock, thresholdRows, scans));

  if (node.estimatedRows !== undefined) scans.push({ node, rows: node.estimatedRows });
  return node;
}

/** Wraps `children` under one synthetic node — D16's model has no dedicated "operation" slot, so
 *  grouping/ordering/dedup show up as a labeled node the same way a real plan node would. */
function wrap(label: string, children: PlanNode[], issues: PlanNode['issues'] = []): PlanNode {
  return { label, metrics: [], issues, children };
}

function blockNodes(block: RawBlock, thresholdRows: number, scans: ScanEstimate[]): PlanNode[] {
  if (block.ordering_operation) {
    const issues: PlanNode['issues'] = block.ordering_operation.using_filesort
      ? [
          {
            severity: 'warn',
            code: 'filesort',
            message: 'a temporary sort file (filesort) was used',
          },
        ]
      : [];
    return [wrap('Sort', blockNodes(block.ordering_operation, thresholdRows, scans), issues)];
  }
  if (block.grouping_operation) {
    return [wrap('Group by', blockNodes(block.grouping_operation, thresholdRows, scans))];
  }
  if (block.duplicates_removal) {
    return [wrap('Duplicates removal', blockNodes(block.duplicates_removal, thresholdRows, scans))];
  }
  if (block.nested_loop) {
    const children = block.nested_loop
      .map((entry) => (entry.table ? tableNode(entry.table, thresholdRows, scans) : null))
      .filter((n): n is PlanNode => n !== null);
    return [wrap('Nested loop join', children)];
  }
  if (block.table) return [tableNode(block.table, thresholdRows, scans)];
  return [];
}

export function parseMysqlPlan(rawText: string, thresholdRows: number): QueryPlan {
  const parsed = JSON.parse(rawText) as { query_block?: RawBlock };
  const block = parsed.query_block ?? {};
  const scans: ScanEstimate[] = [];
  const children = blockNodes(block, thresholdRows, scans);
  // A query_block is always exactly one statement's plan — its own top node is synthetic (D16's
  // model needs one root), carrying the query-level cost the per-table nodes don't repeat.
  const queryCost =
    block.cost_info?.query_cost !== undefined ? Number(block.cost_info.query_cost) : undefined;
  const root: PlanNode = {
    label: 'Query',
    cost: queryCost !== undefined ? { total: queryCost } : undefined,
    metrics: [],
    issues: [],
    children,
  };
  for (const scan of scans) pushWideScanIssue(scan.node, scan.rows, thresholdRows);

  const estimatedRowsRead = maxEstimatedRows(scans);
  return {
    kind: 'mysql',
    root,
    estimatedRowsRead,
    nativeCost: queryCost !== undefined ? { value: queryCost, unit: 'mysql-cost' } : undefined,
    issues: rollupIssues(root),
    overThreshold: isOverThreshold(estimatedRowsRead, thresholdRows),
    raw: rawText,
  };
}
