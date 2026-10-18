import { z } from 'zod';

// P201, P272: internal/memory's wire shapes (Memory, Event, History, Context, StoreResult) and
// bridge/memory.go's MemoryMcpStatus/MemoryInstallResult.
// Who decided a fact. Grade: user (challenged by a human, correct) above external (correct, probably
// incomplete) above agent (reference only).
export const memoryOriginSchema = /*#__PURE__*/ z.enum(['user', 'agent', 'external']);
export type MemoryOrigin = z.infer<typeof memoryOriginSchema>;

export const memoryScopeSchema = /*#__PURE__*/ z.enum(['company', 'project', 'personal']);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryGroupKindSchema = /*#__PURE__*/ z.enum([
  'session',
  'request',
  'task',
  'document',
  'thread',
]);
export type MemoryGroupKind = z.infer<typeof memoryGroupKindSchema>;

// Why a search result ranks where it does: keyword and semantic scores in [0, 1], their fusion
// (relevance), the provenance multipliers, and the total they give.
export const memoryScoreSchema = /*#__PURE__*/ z.object({
  total: z.number(),
  relevance: z.number(),
  keyword: z.number(),
  semantic: z.number(),
  grade: z.number(),
  scope: z.number(),
  recency: z.number(),
  history: z.number(),
  group: z.number(),
  // Scope case against the boosted project; absent without one.
  boost: /*#__PURE__*/ z.enum(['project', 'company', 'personal', 'other-project']).optional(),
});
export type MemoryScore = z.infer<typeof memoryScoreSchema>;

export const memorySchema = /*#__PURE__*/ z.object({
  // Version id "<fact id>.<version>".
  id: z.string(),
  // Fact id "km_...", shared by every version of the fact.
  lineageId: z.string(),
  version: z.number().int(),
  fact: z.string(),
  reason: z.string(),
  keywords: z.array(z.string()),
  origin: memoryOriginSchema,
  // Source name for origin 'external', such as slack; null otherwise.
  sourceTag: z.string().nullable(),
  scope: memoryScopeSchema,
  // Project key for scope 'project', such as github.com/acme/billing; null otherwise.
  project: z.string().nullable(),
  // Claude Code session that wrote this version; null for UI, import and pre-existing rows.
  sessionId: z.string().nullable(),
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
  // Rank explanation; absent outside search.
  score: memoryScoreSchema.optional(),
  // Other current facts sharing a group with this one; absent when none.
  contextCount: z.number().int().optional(),
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
  origin: memoryOriginSchema,
  sourceTag: z.string().nullable(),
  sessionId: z.string().nullable(),
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

export const memoryGroupContextSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  kind: memoryGroupKindSchema,
  key: z.string(),
  title: z.string(),
  // Other facts in the group; `facts` holds at most the requested limit of them.
  total: z.number().int(),
  facts: z.array(memorySchema),
});
export type MemoryGroupContext = z.infer<typeof memoryGroupContextSchema>;

// A fact with the facts stored alongside it, per group (session, request, task, document, thread).
export const memoryContextSchema = /*#__PURE__*/ z.object({
  memory: memorySchema,
  groups: z.array(memoryGroupContextSchema),
});
export type MemoryContext = z.infer<typeof memoryContextSchema>;

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

export const memoryCheckHookSchema = /*#__PURE__*/ z.object({
  executable: z.string(),
  installCommand: z.string(),
  hookLine: z.string(),
});
export type MemoryCheckHook = z.infer<typeof memoryCheckHookSchema>;

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
