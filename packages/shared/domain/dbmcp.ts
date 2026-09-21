import { z } from 'zod';

// M1 §6.2: the Database MCP section's own domain — bridge/dbmcp.go's DbMcpStatus/
// DbMcpInstallResult wire projections. Command carries the plaintext token exactly once — this is
// the one place in the whole system it ever appears at rest in the renderer, never persisted (no
// localStorage, no settings leaf).
export const dbMcpStatusSchema = /*#__PURE__*/ z.object({
  running: z.boolean(),
  command: z.string(),
  claudeAvailable: z.boolean(),
  probed: z.array(z.string()),
  // The current token's own expiry, RFC 3339, "" when nothing is running or the record has not
  // yet been stamped.
  expiresAt: z.string(),
  error: z.string(),
});
export type DbMcpStatus = z.infer<typeof dbMcpStatusSchema>;

// "installed" | "notFound" | "installFailed" — mcpinstall.Install's own outcome vocabulary.
export const dbMcpInstallResultSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum(['installed', 'notFound', 'installFailed']),
  detail: z.string(),
  probed: z.array(z.string()),
});
export type DbMcpInstallResult = z.infer<typeof dbMcpInstallResultSchema>;

// M3 §6.2/§9.3: the plan evidence an approval request can carry — dbmcp.ApprovalPlan's wire
// projection (bridge/dbmcp.go's DbMcpApprovalPlan). Issues are capped at 10 server-side
// (warn-severity first), with issuesOmitted carrying the remainder — the same unbounded-render
// hazard the statement text's own 4000-character cap guards for.
export const dbMcpApprovalPlanIssueSchema = /*#__PURE__*/ z.object({
  severity: /*#__PURE__*/ z.enum(['warn', 'info']),
  code: z.string(),
  message: z.string(),
});
export const dbMcpApprovalPlanSchema = /*#__PURE__*/ z.object({
  estimatedRowsRead: z.number().nullable(),
  thresholdRows: z.number(),
  overThreshold: z.boolean(),
  issues: z.array(dbMcpApprovalPlanIssueSchema),
  issuesOmitted: z.number(),
});
export type DbMcpApprovalPlan = z.infer<typeof dbMcpApprovalPlanSchema>;

// M2 §5/§7.1: the prompt-mode approval queue — bridge/dbmcp.go's DbMcpApprovalRequest/
// DbMcpApprovalSnapshot, gitPairingRequestSchema/gitPairingSnapshotSchema's own shape. statement
// is capped at 4000 (rune-safe) characters on the wire; truncated says whether it was cut.
// M3 §6.2: reason distinguishes M2's own permission prompt from M3's heavy-plan flag — both raise
// the same dialog, one queue, one question ("should this run?"); plan carries the evidence for
// either, null for an ordinary permission prompt with no plan attached.
export const dbMcpApprovalSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  kind: z.string(),
  class: /*#__PURE__*/ z.enum(['read', 'write', 'ddl', 'unknown']),
  statement: z.string(),
  truncated: z.boolean(),
  expiresAtMs: z.number(),
  reason: /*#__PURE__*/ z.enum(['permission', 'heavy']),
  plan: dbMcpApprovalPlanSchema.nullable(),
});
export type DbMcpApproval = z.infer<typeof dbMcpApprovalSchema>;

export const dbMcpApprovalSnapshotSchema = /*#__PURE__*/ z.object({
  pending: dbMcpApprovalSchema.nullable(),
  queued: z.number(),
});
export type DbMcpApprovalSnapshot = z.infer<typeof dbMcpApprovalSnapshotSchema>;
