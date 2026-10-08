import * as DictationService from '@bindings/dictationservice.js';
import * as MemoryImportService from '@bindings/memoryimportservice.js';
import * as MemoryService from '@bindings/memoryservice.js';
import { dictationFrameSchema, dictationStatusSchema } from '@shared/domain/dictation';
import {
  memoryHistorySchema,
  memoryInstallResultSchema,
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
import { Stream } from '@wailsio/runtime';
import { on, unwrap } from '@workbench/bridge/rpc';
import type { DictationHandlers, DictationSession, MemoryControl } from '@workbench/memory/module';

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

// P216: one dictation session is one `dictation` stream. Opening it starts the microphone, a
// `stop` text frame finalises, and closing the socket cancels. Frames are JSON, parsed by zod.
function openDictation({ onFrame, onClose }: DictationHandlers): DictationSession {
  const socket = Stream('dictation');
  socket.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();
  let open = false;
  let closed = false;
  let queued: string | null = null;

  socket.onopen = () => {
    open = true;
    if (queued !== null) socket.send(queued);
    queued = null;
  };
  socket.onmessage = (ev) => {
    if (closed) return;
    const raw = typeof ev.data === 'string' ? ev.data : decoder.decode(ev.data as ArrayBuffer);
    const parsed = dictationFrameSchema.safeParse(JSON.parse(raw));
    if (parsed.success) onFrame(parsed.data);
  };
  socket.onclose = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  return {
    stop() {
      const frame = JSON.stringify({ type: 'stop' });
      if (open) socket.send(frame);
      else queued = frame;
    },
    cancel() {
      closed = true;
      socket.close();
    },
  };
}

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
  dictationStatus: async () => dictationStatusSchema.parse(await unwrap(DictationService.Status())),
  dictationInstall: async (signal) => {
    const call = DictationService.InstallModel();
    signal?.addEventListener('abort', () => call.cancel(), { once: true });
    await unwrap(call);
  },
  dictationRetry: async () => {
    await unwrap(DictationService.Retry());
  },
  onDictation: (cb) => on(CHANNEL.memoryDictation, cb),
  dictationOpen: openDictation,
};
