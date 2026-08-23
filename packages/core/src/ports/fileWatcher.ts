/**
 * Watches `.git` and worktree paths for changes. One real implementation
 * (`packages/git/src/nodeFileWatcher.ts`, W6) shared by both hosts — the extension host and
 * Electron main are the same Node runtime doing the same thing.
 */
import type { Disposable } from "./disposable.ts";

export interface FileWatchEvent {
  readonly path: string;
  readonly kind: "created" | "changed" | "deleted";
}

export interface FileWatchOptions {
  readonly recursive?: boolean;
}

export interface FileWatcher {
  watch(
    paths: readonly string[],
    opts: FileWatchOptions,
    onEvent: (event: FileWatchEvent) => void,
  ): Disposable;
}
