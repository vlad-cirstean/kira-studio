/**
 * `WorkspaceRoots` over `main/recentRepos.ts`'s MRU list (P3 W11, §3.3: "recent-repos store +
 * native dialog") — Electron's counterpart to VS Code's `workspace.workspaceFolders`, since
 * nothing else in the shell names "the repositories this app knows about."
 */
import type { Disposable, RepoCandidate, WorkspaceRoots } from "@kira-version/core";
import type { RecentRepos } from "../main/recentRepos.ts";

export class ElectronWorkspaceRoots implements WorkspaceRoots {
  readonly #recentRepos: RecentRepos;

  constructor(recentRepos: RecentRepos) {
    this.#recentRepos = recentRepos;
  }

  list(): Promise<readonly RepoCandidate[]> {
    return Promise.resolve(this.#recentRepos.list());
  }

  onChanged(fn: () => void): Disposable {
    return this.#recentRepos.onChanged(fn);
  }
}
