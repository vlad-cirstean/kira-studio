import * as MemoryImportService from '@bindings/memoryimportservice.js';
import * as MemoryService from '@bindings/memoryservice.js';
import { claudeLegacyCleanupSchema, claudeLegacyStatusSchema } from '@shared/domain/claudeConfig';
import {
  memoryHistorySchema,
  memoryMcpStatusSchema,
  memorySchema,
  memorySemanticStatusSchema,
  memoryStoreResultSchema,
} from '@shared/domain/memory';
import {
  importChoiceSchema,
  importJobDetailSchema,
  importJobSchema,
} from '@shared/domain/memoryImport';
import { CHANNEL } from '@shared/protocol/events';
import { on, unwrap } from '@workbench/bridge/rpc';
import type { MemoryControl } from '@workbench/memory/module';

// P201: the Memory module's bound-call surface. Results parse through zod at the edge, so a Go
// shape drift fails loudly here rather than as an undefined field in a component.
const memoriesSchema = memorySchema.array();

const IMPORT_ACTIONS = {
  start: MemoryImportService.Start,
  pause: MemoryImportService.Pause,
  resume: MemoryImportService.Resume,
  cancel: MemoryImportService.Cancel,
  discard: MemoryImportService.Discard,
  dismiss: MemoryImportService.Dismiss,
  retryFailed: MemoryImportService.RetryFailed,
} as const;

export const memoryControl: MemoryControl = {
  memorySearch: async (query, includeHistory) =>
    memoriesSchema.parse(await unwrap(MemoryService.Search({ query, includeHistory }))),
  memoryRecent: async () => memoriesSchema.parse(await unwrap(MemoryService.Recent())),
  memoryHistory: async (id) =>
    memoryHistorySchema.parse(await unwrap(MemoryService.History({ id }))),
  memoryStore: async (items, clarifications, signal) => {
    const call = MemoryService.Store({ items, clarifications });
    signal?.addEventListener('abort', () => call.cancel(), { once: true });
    return memoryStoreResultSchema.parse(await unwrap(call));
  },
  memoryMcpStatus: async () => memoryMcpStatusSchema.parse(await unwrap(MemoryService.McpStatus())),
  onMemoryChanged: (cb) => on(CHANNEL.memoryChanged, cb),
  memorySemanticStatus: async () =>
    memorySemanticStatusSchema.parse(await unwrap(MemoryService.SemanticStatus())),
  memorySemanticInstall: async (signal) => {
    const call = MemoryService.InstallSemanticModel();
    signal?.addEventListener('abort', () => call.cancel(), { once: true });
    await unwrap(call);
  },
  memorySemanticRetry: async () => {
    await unwrap(MemoryService.RetrySemantic());
  },
  onMemorySemantic: (cb) => on(CHANNEL.memorySemantic, cb),
  memoryImportChoose: async (kind) =>
    importChoiceSchema.parse(await unwrap(MemoryImportService.Choose({ kind }))),
  memoryImportCreate: async (paths) =>
    importJobSchema.parse(await unwrap(MemoryImportService.Create({ paths }))),
  memoryImportJobs: async () =>
    importJobSchema.array().parse((await unwrap(MemoryImportService.Jobs())) ?? []),
  memoryImportJob: async (id) =>
    importJobDetailSchema.parse(await unwrap(MemoryImportService.Job({ id }))),
  memoryImportAction: async (action, id) => {
    await unwrap(IMPORT_ACTIONS[action]({ id }));
  },
  memoryImportRetryFile: async (fileId) => {
    await unwrap(MemoryImportService.RetryFile({ fileId }));
  },
  onMemoryImport: (cb) => on(CHANNEL.memoryImport, cb),
};

// P233: entries earlier versions registered in the user's Claude Code config; listed and removed
// only on the user's request.
export const claudeLegacyControl = {
  load: async () => claudeLegacyStatusSchema.parse(await unwrap(MemoryService.ClaudeLegacy())),
  remove: async () =>
    claudeLegacyCleanupSchema.parse(await unwrap(MemoryService.RemoveClaudeLegacy())),
};
