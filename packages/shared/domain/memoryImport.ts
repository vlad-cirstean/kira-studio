import { z } from 'zod';

// P211: internal/memory/importer's wire shapes (Job, File, JobDetail) and bridge/memoryimport.go's
// MemoryImportChoice.
export const importJobStateSchema = /*#__PURE__*/ z.enum([
  'scanning',
  'awaiting',
  'running',
  'paused',
  'done',
  'cancelled',
  'failed',
]);
export type ImportJobState = z.infer<typeof importJobStateSchema>;

export const importFileStateSchema = /*#__PURE__*/ z.enum([
  'pending',
  'skipped',
  'extracting',
  'extracted',
  'finalizing',
  'done',
  'failed',
  'cancelled',
]);
export type ImportFileState = z.infer<typeof importFileStateSchema>;

export const importJobSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  roots: z.array(z.string()),
  base: z.string(),
  state: importJobStateSchema,
  reason: z.string(),
  truncated: z.boolean(),
  ignoredCount: z.number().int(),
  estimate: z.object({
    files: z.number().int(),
    chunks: z.number().int(),
    tokens: z.number().int(),
    calls: z.number().int(),
    seconds: z.number().int(),
  }),
  progress: z.object({
    filesDone: z.number().int(),
    filesTotal: z.number().int(),
    chunksDone: z.number().int(),
    chunksTotal: z.number().int(),
  }),
  totals: z.object({
    added: z.number().int(),
    updated: z.number().int(),
    noop: z.number().int(),
    unresolved: z.number().int(),
    failedFiles: z.number().int(),
    skippedFiles: z.number().int(),
  }),
  calls: z.number().int(),
  costUsd: z.number(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importFileSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  relPath: z.string(),
  kind: z.string(),
  size: z.number().int(),
  state: importFileStateSchema,
  reason: z.string(),
  title: z.string(),
  chunkCount: z.number().int(),
  chunksDone: z.number().int(),
  factCount: z.number().int(),
  added: z.number().int(),
  updated: z.number().int(),
  noop: z.number().int(),
  unresolved: z.array(z.object({ fact: z.string(), questions: z.array(z.string()) })),
  dropped: z.array(z.object({ fact: z.string(), why: z.string() })),
  costUsd: z.number(),
});
export type ImportFile = z.infer<typeof importFileSchema>;

export const importJobDetailSchema = /*#__PURE__*/ z.object({
  job: importJobSchema,
  files: z.array(importFileSchema),
});
export type ImportJobDetail = z.infer<typeof importJobDetailSchema>;

export const importChoiceSchema = /*#__PURE__*/ z.object({
  canceled: z.boolean(),
  paths: z.array(z.string()),
});
export type ImportChoice = z.infer<typeof importChoiceSchema>;

export type ImportAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'discard'
  | 'dismiss'
  | 'retryFailed';
