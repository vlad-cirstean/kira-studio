import type { PlanIssue, PlanNode, ScanEstimate } from './planModel';

// P18 (v1.1) D15/D16: the pieces every per-dialect parser (planParsers/*.ts) shares once its own
// tree is built — a dialect-specific structural issue (full scan, missing index, filesort, an
// un-narrowed ClickHouse primary key, ...) is attached to a node by that dialect's own parser,
// since only it knows which raw field means what; what's shared is turning the collected scan
// estimates into D14's single `estimatedRowsRead`/`overThreshold` pair and rolling every node's
// issues up into the plan-level list the panel actually renders.

/** D14's "wide scan" rule: any scan-type node whose own row estimate meets/exceeds the threshold.
 *  Pushed onto that node directly (not the roll-up alone) so the tree view can point at exactly
 *  which node is the expensive one. */
export function pushWideScanIssue(node: PlanNode, rows: number, thresholdRows: number): void {
  if (rows < thresholdRows) return;
  node.issues.push({
    severity: 'warn',
    code: 'wide-scan',
    message: `${node.label} is estimated to read ${rows.toLocaleString()} rows`,
  });
}

/** D14: the widest single read among the dialect's own scan-type nodes — a root/aggregate
 *  estimate is deliberately not used (F11's own example: a root Limit reporting 10 rows over a
 *  Seq Scan reporting 184,153 — the root figure would call that query cheap). */
export function maxEstimatedRows(scans: ScanEstimate[]): number | undefined {
  if (scans.length === 0) return undefined;
  return Math.max(...scans.map((s) => s.rows));
}

/** Depth-first walk collecting every node's own issues into one deduplicated, order-preserving
 *  list (severity+code+message triple) — the panel's issue list above the tree. */
export function rollupIssues(root: PlanNode): PlanIssue[] {
  const seen = new Set<string>();
  const out: PlanIssue[] = [];
  const visit = (node: PlanNode): void => {
    for (const issue of node.issues) {
      const key = `${issue.severity}:${issue.code}:${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(issue);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

/** D14: strictly the row-count threshold — a plan can still carry a `warn` issue (a structural
 *  rule, or sqlite with no estimate at all) with `overThreshold` false; D19's auto-explain strip
 *  trigger is the OR of the two, kept separate here rather than folded together so each stays
 *  independently inspectable in the panel. */
export function isOverThreshold(
  estimatedRowsRead: number | undefined,
  thresholdRows: number,
): boolean {
  return estimatedRowsRead !== undefined && estimatedRowsRead >= thresholdRows;
}
