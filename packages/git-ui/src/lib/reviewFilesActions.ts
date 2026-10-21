import type { BridgeClient } from '../bridge/client.ts';
import { copyToClipboard } from '../state/clipboardActions.ts';
import type { DetailActions } from '../state/detailActions.ts';

/**
 * The review Files pane's action bundle: the same bridge calls `createDetailActions` makes. The
 * pane disables "Open in editor" and "Go to file" for its own diff view (a branch-review delta has
 * no single commit sha), so FileTree's copy-path button is what this bundle really serves.
 */
export function createReviewFilesActions(
  bridge: BridgeClient,
  repoId: () => string | undefined,
  announce: (text: string) => void,
): DetailActions {
  return {
    copy(text, message) {
      void copyToClipboard(bridge, text, message).then((outcome) => {
        announce(outcome.message);
      });
    },
    announce,
    async openInEditor({ sha, path, originalPath, parentIndex, pinned }) {
      const repo = repoId();
      if (!repo) return;
      await bridge.request('editor.openDiff', {
        repoId: repo,
        sha,
        path,
        ...(originalPath !== undefined ? { originalPath } : {}),
        parentIndex,
        pinned,
      });
    },
    async openAllChanges({ sha, parentIndex }) {
      const repo = repoId();
      if (!repo) throw new Error('openAllChanges: no active repo');
      return bridge.request('editor.openAllChanges', { repoId: repo, sha, parentIndex });
    },
    async goToFile({ rev, path, line }) {
      const repo = repoId();
      if (!repo) throw new Error('goToFile: no active repo');
      return bridge.request('editor.goToFile', { repoId: repo, rev, path, line });
    },
    async openChangeRequest({ number }) {
      const repo = repoId();
      if (!repo) throw new Error('openChangeRequest: no active repo');
      await bridge.request('changeRequest.openExternal', { repoId: repo, number });
    },
    async openExternalLink(url) {
      await bridge.request('link.openExternal', { url });
    },
    async revealInGraph({ sha }) {
      const repo = repoId();
      if (!repo) return { revealed: false };
      return bridge.request('graph.revealCommit', { repoId: repo, sha });
    },
  };
}
