import { z } from 'zod';

// P201: internal/memory's wire shapes (Memory, Event, History, StoreResult) and
// bridge/memory.go's MemoryMcpStatus/MemoryInstallResult.
export const memoryAuthorSchema = /*#__PURE__*/ z.enum(['user', 'agent']);
export type MemoryAuthor = z.infer<typeof memoryAuthorSchema>;

export const memorySchema = /*#__PURE__*/ z.object({
  id: z.string(),
  lineageId: z.string(),
  version: z.number().int(),
  fact: z.string(),
  reason: z.string(),
  keywords: z.array(z.string()),
  author: memoryAuthorSchema,
  status: /*#__PURE__*/ z.enum(['current', 'superseded']),
  // True for a superseded version: an old value kept as history.
  historical: z.boolean(),
  supersedesId: z.string().nullable(),
  supersededById: z.string().nullable(),
  createdAt: z.string(),
  supersededAt: z.string().nullable(),
  // Versions in this memory's lineage.
  versions: z.number().int(),
  // How a search found this memory; absent outside search.
  match: /*#__PURE__*/ z.enum(['keyword', 'semantic', 'both']).optional(),
});
export type Memory = z.infer<typeof memorySchema>;

export const memoryEventSchema = /*#__PURE__*/ z.object({
  seq: z.number().int(),
  requestId: z.string(),
  source: /*#__PURE__*/ z.enum(['mcp', 'ui', 'import']),
  // P211: the import job's file id and its path label; set only for source 'import'.
  sourceRef: z.string().nullable(),
  sourceLabel: z.string().optional(),
  action: /*#__PURE__*/ z.enum(['add', 'update', 'noop']),
  lineageId: z.string(),
  memoryId: z.string(),
  previousId: z.string().nullable(),
  author: memoryAuthorSchema,
  rationale: z.string(),
  createdAt: z.string(),
});
export type MemoryEvent = z.infer<typeof memoryEventSchema>;

export const memoryHistorySchema = /*#__PURE__*/ z.object({
  memories: z.array(memorySchema),
  events: z.array(memoryEventSchema),
});
export type MemoryHistory = z.infer<typeof memoryHistorySchema>;

export const memoryItemSchema = /*#__PURE__*/ z.object({ fact: z.string(), reason: z.string() });
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const memoryClarificationSchema = /*#__PURE__*/ z.object({
  question: z.string(),
  answer: z.string(),
});
export type MemoryClarification = z.infer<typeof memoryClarificationSchema>;

export const memoryStoreResultSchema = /*#__PURE__*/ z.object({
  status: /*#__PURE__*/ z.enum(['stored', 'challenged']),
  challenges: z.array(
    z.object({ index: z.number().int(), fact: z.string(), questions: z.array(z.string()) }),
  ),
  outcomes: z.array(
    z.object({
      fact: z.string(),
      reason: z.string(),
      action: /*#__PURE__*/ z.enum(['add', 'update', 'noop', 'failed']),
      id: z.string(),
      lineageId: z.string(),
      version: z.number().int(),
      previousId: z.string(),
      why: z.string(),
      error: z.string(),
    }),
  ),
});
export type MemoryStoreResult = z.infer<typeof memoryStoreResultSchema>;

export const memoryMcpStatusSchema = /*#__PURE__*/ z.object({
  command: z.string(),
  executable: z.string(),
  claudeAvailable: z.boolean(),
  probed: z.array(z.string()),
});
export type MemoryMcpStatus = z.infer<typeof memoryMcpStatusSchema>;

// "installed" | "notFound" | "installFailed" — mcpinstall's outcome vocabulary.
export const memoryInstallResultSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum(['installed', 'notFound', 'installFailed']),
  detail: z.string(),
  probed: z.array(z.string()),
});
export type MemoryInstallResult = z.infer<typeof memoryInstallResultSchema>;

// P210: bridge/memory.go's SemanticStatus. While downloading, done/total are bytes; otherwise they
// are memory counts (vectors stored vs memories).
export const memorySemanticStatusSchema = /*#__PURE__*/ z.object({
  state: /*#__PURE__*/ z.enum([
    'off',
    'notInstalled',
    'downloading',
    'unavailable',
    'indexing',
    'ready',
  ]),
  message: z.string(),
  model: z.string(),
  done: z.number().int(),
  total: z.number().int(),
});
export type MemorySemanticStatus = z.infer<typeof memorySemanticStatusSchema>;
