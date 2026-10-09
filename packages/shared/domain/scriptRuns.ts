import { z } from 'zod';
import { runOutcomeSchema } from './runOutcome';

// Mirrors scriptruns.Run — one Automations execution.
export const scriptRunStateSchema = /*#__PURE__*/ z.enum([
  'running',
  'done',
  'failed',
  'cancelled',
  'blocked',
]);
export type ScriptRunState = z.infer<typeof scriptRunStateSchema>;

export const scriptRunSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  scriptId: z.string(),
  scriptName: z.string(),
  color: z.string(),
  kind: z.string(),
  trigger: z.enum(['terminal', 'manual', 'ade', 'scheduled']),
  state: scriptRunStateSchema,
  terminalId: z.string(),
  cwd: z.string(),
  command: z.string(),
  outcome: runOutcomeSchema.nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type ScriptRun = z.infer<typeof scriptRunSchema>;
