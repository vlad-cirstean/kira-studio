import { isOverThreshold, maxEstimatedRows, pushWideScanIssue, rollupIssues } from '../planIssues';
import type { PlanNode, QueryPlan, ScanEstimate } from '../planModel';

// P18 (v1.1) D13/D15/D16: Postgres 18's `EXPLAIN (FORMAT JSON, COSTS TRUE, ...)` returns one row,
// one column QUERY PLAN, whose text is a JSON array of one `{ Plan: {...} }` — F11. Only fields
// available *without* ANALYZE are read here; §7.3's own check is that Actual Rows/Actual Total
// Time/Rows Removed by Filter/Sort Method/Shared Hit Blocks never appear below — those require
// ANALYZE, which this phase never issues (§0.3).
interface RawNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  Alias?: string;
  'Index Name'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  Filter?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Join Type'?: string;
  Strategy?: string;
  'Sort Key'?: string[];
  'Group Key'?: string[];
  'Parallel Aware'?: boolean;
  Disabled?: boolean;
  Plans?: RawNode[];
}

// D14: the node types a full/partial *read* actually happens at — the ones whose own `Plan Rows`
// D14's estimatedRowsRead is the max over.
const SCAN_NODE_TYPES = new Set([
  'Seq Scan',
  'Index Scan',
  'Index Only Scan',
  'Bitmap Heap Scan',
  'CTE Scan',
  'Function Scan',
  'Foreign Scan',
]);

// Every raw field this parser reads into a typed slot — the rest fall through to `metrics`
// verbatim (D16), so a field Postgres adds later still shows up rather than vanishing silently.
const TYPED_KEYS = new Set([
  'Node Type',
  'Relation Name',
  'Startup Cost',
  'Total Cost',
  'Plan Rows',
  'Filter',
  'Index Cond',
  'Hash Cond',
  'Plans',
]);

function metricsFrom(raw: RawNode): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (TYPED_KEYS.has(key) || value === undefined) continue;
    out.push({ label: key, value: Array.isArray(value) ? value.join(', ') : String(value) });
  }
  return out;
}

function buildNode(raw: RawNode, thresholdRows: number, scans: ScanEstimate[]): PlanNode {
  const nodeType = raw['Node Type'] ?? 'Node';
  const relation = raw['Relation Name'];
  const label = relation
    ? `${nodeType} on ${raw.Alias && raw.Alias !== relation ? `${relation} ${raw.Alias}` : relation}`
    : nodeType;

  const node: PlanNode = {
    label,
    relation,
    detail: raw.Filter ?? raw['Index Cond'] ?? raw['Hash Cond'],
    estimatedRows: raw['Plan Rows'],
    cost:
      raw['Total Cost'] !== undefined
        ? { total: raw['Total Cost'], startup: raw['Startup Cost'] }
        : undefined,
    metrics: metricsFrom(raw),
    issues: [],
    children: (raw.Plans ?? []).map((child) => buildNode(child, thresholdRows, scans)),
  };

  // D15: full scan with a predicate — a Seq Scan that still carries a Filter means the planner
  // read every row and then discarded most of them client-side.
  if (nodeType === 'Seq Scan' && raw.Filter !== undefined) {
    node.issues.push({
      severity: 'warn',
      code: 'full-scan',
      message: `full table scan on "${relation ?? '?'}" with a filter — no index was used`,
    });
  }
  // D15 (info): index-only scan is a good sign, not a problem — the panel is not only bad news.
  if (nodeType === 'Index Only Scan') {
    node.issues.push({
      severity: 'info',
      code: 'index-only-scan',
      message: `"${relation ?? '?'}" is read entirely from its index — no heap access needed`,
    });
  }
  // D15: a nested loop whose inner side is wide re-executes that inner scan once per outer row.
  if (nodeType === 'Nested Loop') {
    const wideInner = node.children.find((c) => (c.estimatedRows ?? 0) >= 10_000);
    if (wideInner) {
      node.issues.push({
        severity: 'warn',
        code: 'nested-loop-wide-inner',
        message: `nested loop repeats a scan estimated at ${wideInner.estimatedRows?.toLocaleString()} rows for every outer row`,
      });
    }
  }

  if (SCAN_NODE_TYPES.has(nodeType) && node.estimatedRows !== undefined) {
    scans.push({ node, rows: node.estimatedRows });
  }
  return node;
}

export function parsePostgresPlan(rawText: string, thresholdRows: number): QueryPlan {
  const parsed = JSON.parse(rawText) as Array<{ Plan: RawNode }>;
  const scans: ScanEstimate[] = [];
  const root = buildNode(parsed[0]?.Plan ?? {}, thresholdRows, scans);
  for (const scan of scans) pushWideScanIssue(scan.node, scan.rows, thresholdRows);

  const estimatedRowsRead = maxEstimatedRows(scans);
  return {
    kind: 'postgres',
    root,
    estimatedRowsRead,
    nativeCost: root.cost ? { value: root.cost.total, unit: 'postgres-planner' } : undefined,
    issues: rollupIssues(root),
    overThreshold: isOverThreshold(estimatedRowsRead, thresholdRows),
    raw: rawText,
  };
}
