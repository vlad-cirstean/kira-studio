import type {
  Memory,
  MemoryClarification,
  MemoryCommentCheck,
  MemoryContext,
  MemoryHistory,
  MemoryInstallResult,
  MemoryItem,
  MemoryMcpStatus,
  MemoryOrigin,
  MemoryScope,
  MemorySemanticStatus,
  MemoryStoreResult,
} from '@shared/domain/memory';
import type {
  DistillArgs,
  DistillChoice,
  DistillLimits,
  DistillProgress,
  DistillResult,
} from '@shared/domain/memoryDistill';
import type {
  ImportAction,
  ImportChoice,
  ImportJob,
  ImportJobDetail,
  ImportStartArgs,
} from '@shared/domain/memoryImport';
import { type InjectionKey, inject } from 'vue';

// P201: the Memory module's injected context, the shared automations module's shape — the same
// components mount in any app that provides a control.

/** Search narrowing: empty `scopes`/`origins` mean all; `project` ranks its facts first, "" boosts none. */
export interface MemorySearchFilters {
  scopes: MemoryScope[];
  origins: MemoryOrigin[];
  project: string;
}

export interface MemoryControl {
  memorySearch(
    query: string,
    includeHistory: boolean,
    filters: MemorySearchFilters,
  ): Promise<Memory[]>;
  memoryRecent(): Promise<Memory[]>;
  memoryHistory(id: string): Promise<MemoryHistory>;
  /** A fact with the facts stored alongside it, per group. `id` is a fact id or a version id. */
  memoryContext(id: string): Promise<MemoryContext>;
  /** Project keys of the current facts, for the Add dialog's suggestions. */
  memoryProjects(): Promise<string[]>;
  /**
   * Stores as the user. `project` is the key for scope 'project', empty otherwise. Aborting `signal`
   * cancels the in-flight store.
   */
  memoryStore(
    items: MemoryItem[],
    clarifications: MemoryClarification[],
    scope: MemoryScope,
    project: string,
    signal?: AbortSignal,
  ): Promise<MemoryStoreResult>;
  memoryMcpStatus(): Promise<MemoryMcpStatus>;
  memoryCommentCheck(): Promise<MemoryCommentCheck>;
  memoryMcpInstall(): Promise<MemoryInstallResult>;
  onMemoryChanged(cb: () => void): () => void;
  memorySemanticStatus(): Promise<MemorySemanticStatus>;
  /** Downloads the embedding model; aborting `signal` cancels the download. */
  memorySemanticInstall(signal?: AbortSignal): Promise<void>;
  memorySemanticRetry(): Promise<void>;
  onMemorySemantic(cb: () => void): () => void;
  /** Opens the native picker: several documents or one folder. */
  memoryImportChoose(kind: 'files' | 'folder'): Promise<ImportChoice>;
  /** Starts a background scan; the job awaits confirmation once scanned. */
  memoryImportCreate(paths: string[]): Promise<ImportJob>;
  memoryImportJobs(): Promise<ImportJob[]>;
  memoryImportJob(id: string): Promise<ImportJobDetail>;
  memoryImportStart(args: ImportStartArgs): Promise<void>;
  memoryImportAction(action: ImportAction, id: string): Promise<void>;
  memoryImportRetryFile(fileId: string): Promise<void>;
  onMemoryImport(cb: () => void): () => void;
  /** Condenses text or a file into terse lines; writes nothing. Aborting `signal` cancels the call. */
  memoryDistill(args: DistillArgs, signal?: AbortSignal): Promise<DistillResult>;
  memoryDistillLimits(): Promise<DistillLimits>;
  /** Opens the native single-file picker. */
  memoryDistillChoose(): Promise<DistillChoice>;
  /** Saves the lines as a document and scans it; the job awaits confirmation once scanned. */
  memoryDistillToImport(lines: string[], source: string): Promise<ImportJob>;
  onMemoryDistill(cb: (progress: DistillProgress) => void): () => void;
}

export interface MemoryModuleContext {
  control: MemoryControl;
  /** Opens the host's settings at its memory setup section. */
  openSettings(): void;
}

export const memoryModuleKey: InjectionKey<MemoryModuleContext> = Symbol('memoryModule');

export function useMemoryModule(): MemoryModuleContext {
  const ctx = inject(memoryModuleKey);
  if (!ctx) throw new Error('useMemoryModule: no MemoryModuleContext provided');
  return ctx;
}
