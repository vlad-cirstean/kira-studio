/**
 * Candidate repository roots the app can open — VS Code's workspace folders, or Electron's
 * recent-repos list plus a native "open folder" dialog.
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
