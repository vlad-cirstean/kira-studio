import type { DictationFrame, DictationStatus } from '@shared/domain/dictation';
import type {
  Memory,
  MemoryClarification,
  MemoryHistory,
  MemoryInstallResult,
  MemoryItem,
  MemoryMcpStatus,
  MemorySemanticStatus,
  MemoryStoreResult,
} from '@shared/domain/memory';
import type {
  ImportAction,
  ImportChoice,
  ImportJob,
  ImportJobDetail,
} from '@shared/domain/memoryImport';
import { type InjectionKey, inject } from 'vue';

// P201: the Memory module's injected context, the shared terminal module's shape — the same
// components mount in any app that provides a control.

/** Callbacks for one dictation stream. `onClose` fires once, after the final frame or on failure. */
export interface DictationHandlers {
  onFrame(frame: DictationFrame): void;
  onClose(): void;
}

export interface DictationSession {
  /** Finishes the session: a `final` frame follows, then the stream closes. */
  stop(): void;
  /** Discards the session and closes the stream without further frames. */
  cancel(): void;
}

export interface MemoryControl {
  memorySearch(query: string, includeHistory: boolean): Promise<Memory[]>;
  memoryRecent(): Promise<Memory[]>;
  memoryHistory(id: string): Promise<MemoryHistory>;
  /** Aborting `signal` cancels the in-flight store. */
  memoryStore(
    items: MemoryItem[],
    clarifications: MemoryClarification[],
    signal?: AbortSignal,
  ): Promise<MemoryStoreResult>;
  memoryMcpStatus(): Promise<MemoryMcpStatus>;
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
  memoryImportAction(action: ImportAction, id: string): Promise<void>;
  memoryImportRetryFile(fileId: string): Promise<void>;
  onMemoryImport(cb: () => void): () => void;
  /** P216: local speech to text. `dictationStatus` is `off` when the host cannot dictate. */
  dictationStatus(): Promise<DictationStatus>;
  /** Downloads the speech model; aborting `signal` cancels the download. */
  dictationInstall(signal?: AbortSignal): Promise<void>;
  dictationRetry(): Promise<void>;
  onDictation(cb: () => void): () => void;
  /** Opens a microphone session; frames arrive through `handlers`. */
  dictationOpen(handlers: DictationHandlers): DictationSession;
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
