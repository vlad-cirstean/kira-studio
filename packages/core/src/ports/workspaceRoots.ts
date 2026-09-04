/**
 * Candidate repository roots the app can open — VS Code's workspace folders today;
 * `ports/testFakes.ts`'s `FakeWorkspaceRoots` is the second implementation, for unit tests. A
 * host with no notion of "workspace folders" (a recent-repos list plus a native "open folder"
 * dialog, say) is exactly the kind of variation this port exists to hide.
 */
import type { Disposable } from "./disposable.ts";

export interface RepoCandidate {
  readonly path: string;
  readonly label: string;
}

export interface WorkspaceRoots {
  list(): Promise<readonly RepoCandidate[]>;
  onChanged(fn: () => void): Disposable;
}
