/**
 * Watches `.git` and worktree paths for changes. One real implementation today
 * (`packages/git/src/nodeFileWatcher.ts`, W6), used by the extension host — any future
 * Node-based host reuses it unchanged, since it needs nothing host-specific.
 * `ports/testFakes.ts`'s `FakeFileWatcher` is the second implementation, for unit tests.
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
