import { z } from 'zod';
import { runOutcomeSchema } from './runOutcome';
import { scriptDirSchema } from './scripts';

// Mirrors scriptruns.Run — one Automations execution.
export const scriptRunStateSchema = /*#__PURE__*/ z.enum([
  'running',
  'done',
  'failed',
  'cancelled',
  'blocked',
]);
export type ScriptRunState = z.infer<typeof scriptRunStateSchema>;

// Mirrors scriptruns.RunParam: a secret's value is the mask.
export const scriptRunParamSchema = /*#__PURE__*/ z.object({ name: z.string(), value: z.string() });
export type ScriptRunParam = z.infer<typeof scriptRunParamSchema>;

// Mirrors scriptruns.RunTools: what a smart run was launched with.
export const scriptRunToolsSchema = /*#__PURE__*/ z.object({
  tools: z.array(z.string()),
  allowedTools: z.array(z.string()),
  mcpServers: z.array(z.string()),
});
export type ScriptRunTools = z.infer<typeof scriptRunToolsSchema>;

export const scriptRunSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  scriptId: z.string(),
  scriptName: z.string(),
  color: z.string(),
  kind: z.enum(['script', 'smart']),
  trigger: z.enum(['terminal', 'manual', 'ade', 'scheduled']),
  state: scriptRunStateSchema,
  terminalId: z.string(),
  cwd: z.string(),
  command: z.string(),
  outcome: runOutcomeSchema.nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  // Smart runs only; empty for a script run.
  model: z.string(),
  sessionId: z.string(),
  prompt: z.string(),
  params: z.array(scriptRunParamSchema),
  tools: scriptRunToolsSchema,
  // Set when started for an ADE task (Kira Space).
  taskId: z.string(),
  taskTitle: z.string(),
  branchId: z.string(),
  branchLabel: z.string(),
});
export type ScriptRun = z.infer<typeof scriptRunSchema>;

// Mirrors scriptruns.LogChunk / LogPage / LogPush: a smart run's log lines.
export const scriptRunLogChunkSchema = /*#__PURE__*/ z.object({
  seq: z.number(),
  stream: z.enum(['stdout', 'stderr', 'event']),
  text: z.string(),
});
export type ScriptRunLogChunk = z.infer<typeof scriptRunLogChunkSchema>;

export const scriptRunLogPageSchema = /*#__PURE__*/ z.object({
  chunks: z.array(scriptRunLogChunkSchema),
  truncated: z.boolean(),
});
export type ScriptRunLogPage = z.infer<typeof scriptRunLogPageSchema>;

export const scriptRunLogPushSchema = /*#__PURE__*/ z.object({
  runId: z.string(),
  chunks: z.array(scriptRunLogChunkSchema),
});
export type ScriptRunLogPush = z.infer<typeof scriptRunLogPushSchema>;

// Mirrors scriptruns.Preview / EnvVar: what a run would do, exactly as Start does it.
export const scriptRunEnvVarSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  value: z.string(),
  secret: z.boolean(),
  fromVar: z.string(),
});
export type ScriptRunEnvVar = z.infer<typeof scriptRunEnvVarSchema>;

export const scriptRunPartSchema = /*#__PURE__*/ z.object({
  text: z.string(),
  var: z.string(),
  value: z.string(),
});
export type ScriptRunPart = z.infer<typeof scriptRunPartSchema>;

// Mirrors scriptruns.TaskChoice / BranchChoice: what the run dialog asks the user to pick.
export const scriptRunTaskChoiceSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  title: z.string(),
});
export type ScriptRunTaskChoice = z.infer<typeof scriptRunTaskChoiceSchema>;

export const scriptRunBranchChoiceSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  label: z.string(),
  disabled: z.boolean(),
  why: z.string(),
});
export type ScriptRunBranchChoice = z.infer<typeof scriptRunBranchChoiceSchema>;

// Mirrors scriptruns.RunADE: the task and branch a run resolved.
export const scriptRunAdeSchema = /*#__PURE__*/ z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  branchId: z.string(),
  branchLabel: z.string(),
});
export type ScriptRunAde = z.infer<typeof scriptRunAdeSchema>;

export const scriptRunPreviewSchema = /*#__PURE__*/ z.object({
  kind: z.enum(['script', 'smart']),
  missing: z.array(z.string()),
  blocker: z.string(),
  dir: scriptDirSchema,
  body: z.string(),
  prompt: z.array(scriptRunPartSchema),
  suffix: z.string(),
  env: z.array(scriptRunEnvVarSchema),
  command: z.string(),
  model: z.string(),
  maxBudgetUsd: z.number(),
  timeout: z.string(),
  tools: z.array(z.string()),
  allowedTools: z.array(z.string()),
  mcpServers: z.array(z.string()),
  hash: z.string(),
  needs: z.object({
    tasks: z.array(scriptRunTaskChoiceSchema),
    branches: z.array(scriptRunBranchChoiceSchema),
  }),
  ade: scriptRunAdeSchema.nullable(),
});
export type ScriptRunPreview = z.infer<typeof scriptRunPreviewSchema>;

// The run dialog's request: values per param, and a one-off prompt body that is never saved.
export interface ScriptRunArgs {
  scriptId: string;
  params: Record<string, string[]>;
  prompt: string | null;
  // Kira Space: the ADE task and branch to run for; '' when none is chosen.
  taskId: string;
  branchId: string;
}

export const scriptRunStartedSchema = /*#__PURE__*/ z.object({
  runId: z.string(),
  terminal: z.object({ token: z.string(), cwd: z.string() }).nullable(),
});
export type ScriptRunStarted = z.infer<typeof scriptRunStartedSchema>;
