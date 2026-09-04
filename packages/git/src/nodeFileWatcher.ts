/**
 * The one real `FileWatcher` (packages/core/src/ports/fileWatcher.ts), `node:fs.watch` based,
 * written once for the same reason `nodeProcessRunner.ts` is: the extension host runs on Node,
 * and any future Node-based host reuses this unchanged rather than reimplementing it.
 *
 * `fs.watch({ recursive: true })` on macOS is FSEvents-backed and coalesces events aggressively,
 * so a caller must re-read state rather than trust an event's `kind` to be precise — `watcher.ts`
 * treats every event on a relevant path as "something changed here", never as a definitive
 * created/changed/deleted fact. A watch on a file git replaces atomically (e.g. `refs/heads/x`
 * via rename) can silently stop firing once the original inode is gone, so `watcher.ts` watches
 * directories, not individual ref files.
 */
import { existsSync, type FSWatcher, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import type {
  Disposable,
  FileWatchEvent,
  FileWatcher,
  FileWatchOptions,
  Logger,
} from "@kira-version/core";

/** A `node:fs.watch` failure on one watched path (EMFILE, the path disappearing, ...). Logged
 *  and that one watch is torn down; it never reaches a caller as an unhandled `error` event or
 *  an exception out of `watch()`. */
export class FileWatchError extends Error {
  readonly path: string;
  override readonly cause: unknown;

  constructor(path: string, cause: unknown) {
    super(`watching '${path}' failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "FileWatchError";
    this.path = path;
    this.cause = cause;
  }
}

export class NodeFileWatcher implements FileWatcher {
  readonly #logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.#logger = logger;
  }

  watch(
    paths: readonly string[],
    opts: FileWatchOptions,
    onEvent: (event: FileWatchEvent) => void,
  ): Disposable {
    const watchers: FSWatcher[] = [];

    for (const path of paths) {
      const watcher = this.#watchOne(path, opts, onEvent);
      if (watcher) watchers.push(watcher);
    }

    return {
      dispose: () => {
        for (const watcher of watchers) watcher.close();
      },
    };
  }

  #watchOne(
    path: string,
    opts: FileWatchOptions,
    onEvent: (event: FileWatchEvent) => void,
  ): FSWatcher | undefined {
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(path, { recursive: opts.recursive ?? false }, (eventType, filename) => {
        const fullPath = filename ? join(path, filename.toString()) : path;
        const kind =
          eventType === "change" ? "changed" : existsSync(fullPath) ? "created" : "deleted";
        onEvent({ path: fullPath, kind });
      });
    } catch (err) {
      this.#logger?.log("error", "watch setup failed", new FileWatchError(path, err));
      return undefined;
    }
    watcher.on("error", (err) => {
      this.#logger?.log("error", "watch failed", new FileWatchError(path, err));
      watcher.close();
    });
    return watcher;
  }
}
