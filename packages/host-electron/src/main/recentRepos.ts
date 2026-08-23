/**
 * The Electron half of `WorkspaceRoots` (§3.3) — a `Storage`-backed MRU list of repository
 * paths, since Electron has no `workspace.workspaceFolders` equivalent. `ports/workspaceRoots.ts`
 * wraps this to satisfy the port; `main/index.ts`'s `repo.open` wrapper and `main/menu.ts`'s
 * Open Repository… command are this list's only writers.
 */
import { basename } from "node:path";
import type { Disposable, RepoCandidate, Storage } from "@kira-version/core";

const STORAGE_KEY = "recentRepos";
const MAX_ENTRIES = 10;

export class RecentRepos {
  readonly #storage: Storage;
  readonly #listeners = new Set<() => void>();

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  list(): readonly RepoCandidate[] {
    const paths = this.#storage.get<readonly string[]>("global", STORAGE_KEY) ?? [];
    return paths.map((path) => ({ path, label: basename(path) }));
  }

  async add(path: string): Promise<void> {
    const existing = this.#storage.get<readonly string[]>("global", STORAGE_KEY) ?? [];
    const next = [path, ...existing.filter((entry) => entry !== path)].slice(0, MAX_ENTRIES);
    await this.#storage.set("global", STORAGE_KEY, next);
    for (const listener of this.#listeners) listener();
  }

  onChanged(fn: () => void): Disposable {
    this.#listeners.add(fn);
    return { dispose: () => this.#listeners.delete(fn) };
  }
}
