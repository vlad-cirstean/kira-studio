import { z } from 'zod';

// Mirrors internal/runoutcome.Outcome.
export const runStatusSchema = /*#__PURE__*/ z.enum([
  'done',
  'failed',
  'blocked',
  'cancelled',
  'skipped',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runSourceSchema = /*#__PURE__*/ z.enum([
  'agent',
  'exit',
  'timeout',
  'start',
  'user',
  'restart',
  'verify',
  'budget',
  'schedule',
]);
export type RunSource = z.infer<typeof runSourceSchema>;

export const runOutcomeSchema = /*#__PURE__*/ z.object({
  status: runStatusSchema,
  reason: z.string(),
  source: runSourceSchema,
  reported: z.boolean(),
  exitCode: z.number().optional(),
  lastError: z.string().optional(),
  summary: z.string().optional(),
  costUsd: z.number().optional(),
  permissionDenials: z.array(z.string()).optional(),
});
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
