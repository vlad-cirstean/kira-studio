import * as MemoryService from '@bindings/memoryservice.js';
import {
  memoryHistorySchema,
  memoryInstallResultSchema,
  memoryMcpStatusSchema,
  memorySchema,
  memorySemanticStatusSchema,
  memoryStoreResultSchema,
} from '@shared/domain/memory';
import { CHANNEL } from '@shared/protocol/events';
import { on, unwrap } from '@workbench/bridge/rpc';
import type { MemoryControl } from '@workbench/memory/module';

// P201: the Memory module's bound-call surface. Results parse through zod at the edge, so a Go
// shape drift fails loudly here rather than as an undefined field in a component.
const memoriesSchema = memorySchema.array();

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
};
