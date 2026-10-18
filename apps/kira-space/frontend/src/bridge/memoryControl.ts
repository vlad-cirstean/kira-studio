import * as MemoryDistillService from '@bindings/memorydistillservice.js';
import * as MemoryImportService from '@bindings/memoryimportservice.js';
import * as MemoryService from '@bindings/memoryservice.js';
import {
  memoryCheckHookSchema,
  memoryContextSchema,
  memoryHistorySchema,
  memoryInstallResultSchema,
  memoryMcpStatusSchema,
  memorySchema,
  memorySemanticStatusSchema,
  memoryStoreResultSchema,
} from '@shared/domain/memory';
import {
  distillChoiceSchema,
  distillLimitsSchema,
  distillProgressSchema,
  distillResultSchema,
} from '@shared/domain/memoryDistill';
import {
  importChoiceSchema,
  importJobDetailSchema,
  importJobSchema,
} from '@shared/domain/memoryImport';
import { CHANNEL } from '@shared/protocol/events';
import { on, unwrap } from '@workbench/bridge/rpc';
import type { MemoryControl } from '@workbench/memory/module';
import { z } from 'zod';

// P201: the Memory module's bound-call surface. Results parse through zod at the edge, so a Go
// shape drift fails loudly here rather than as an undefined field in a component.
const memoriesSchema = memorySchema.array();

const IMPORT_ACTIONS = {
  pause: MemoryImportService.Pause,
  resume: MemoryImportService.Resume,
  cancel: MemoryImportService.Cancel,
  discard: MemoryImportService.Discard,
  dismiss: MemoryImportService.Dismiss,
  retryFailed: MemoryImportService.RetryFailed,
} as const;

export const memoryControl: MemoryControl = {
  memorySearch: async (query, includeHistory, { scopes, origins, project }) =>
    memoriesSchema.parse(
      await unwrap(MemoryService.Search({ query, includeHistory, scopes, origins, project })),
    ),
  memoryRecent: async () => memoriesSchema.parse(await unwrap(MemoryService.Recent())),
  memoryHistory: async (id) =>
    memoryHistorySchema.parse(await unwrap(MemoryService.History({ id }))),
  memoryStore: async (items, clarifications, scope, project, signal) => {
    const call = MemoryService.Store({ items, clarifications, scope, project });
    signal?.addEventListener('abort', () => call.cancel(), { once: true });
    return memoryStoreResultSchema.parse(await unwrap(call));
  },
  memoryContext: async (id) =>
    memoryContextSchema.parse(await unwrap(MemoryService.Context({ id, limit: 0 }))),
  memoryProjects: async () =>
    z
      .string()
      .array()
      .parse((await unwrap(MemoryService.Projects())) ?? []),
  memoryMcpStatus: async () => memoryMcpStatusSchema.parse(await unwrap(MemoryService.McpStatus())),
  memoryCheckHook: async () => memoryCheckHookSchema.parse(await unwrap(MemoryService.CheckHook())),
  memoryMcpInstall: async () =>
    memoryInstallResultSchema.parse(await unwrap(MemoryService.InstallClaudeCode())),
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
  memoryImportStart: async ({ id, origin, sourceTag, scope, project, writeDoc }) => {
    await unwrap(
      MemoryImportService.Start({
        id,
        origin: origin ?? '',
        sourceTag: sourceTag ?? '',
        scope: scope ?? '',
        project: project ?? '',
        writeDoc: writeDoc ?? false,
      }),
    );
  },
  memoryImportAction: async (action, id) => {
    await unwrap(IMPORT_ACTIONS[action]({ id }));
  },
  memoryImportRetryFile: async (fileId) => {
    await unwrap(MemoryImportService.RetryFile({ fileId }));
  },
  onMemoryImport: (cb) => on(CHANNEL.memoryImport, cb),
  memoryDistill: async ({ requestId, text, path, mode }, signal) => {
    const call = MemoryDistillService.Distill({
      requestId,
      text: text ?? '',
      path: path ?? '',
      mode,
    });
    signal?.addEventListener('abort', () => call.cancel(), { once: true });
    return distillResultSchema.parse(await unwrap(call));
  },
  memoryDistillLimits: async () =>
    distillLimitsSchema.parse(await unwrap(MemoryDistillService.Limits())),
  memoryDistillChoose: async () =>
    distillChoiceSchema.parse(await unwrap(MemoryDistillService.Choose())),
  memoryDistillToImport: async (lines, source) =>
    importJobSchema.parse(await unwrap(MemoryDistillService.ToImport({ lines, source }))),
  onMemoryDistill: (cb) =>
    on(CHANNEL.memoryDistill, (payload) => cb(distillProgressSchema.parse(payload))),
};
