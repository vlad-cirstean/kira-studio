/**
 * D4/D11's "go to file" composition (F12) — the server resolves the on-disk-vs-object-database
 * decision and (for a live file) the drift hunks; the line arithmetic itself stays here, over
 * `@kira/git-core`'s already-tested `mapLineAcrossDiff`, never a second, unproven implementation
 * of the same trickiest math (G4 D11's own warning).
 *
 * Its own file, deliberately smaller than `diffToolbar.ts` (G14 D9), so that `proxyHandlers.ts`
 * — which never imports `vscode` (`revealReview`/`renderReviewComments`/`notifyCommentsMutated`
 * are all plain functions for exactly that reason, per that file's own doc comment) — can still
 * import this one real implementation without pulling `vscode` in along with it. `diffToolbar.ts`
 * imports it too, for the diff editor's own "Go to file" toolbar button.
 */
import { basename } from 'node:path';
import type { EditorIntegration } from '@kira/git-core';
import { mapLineAcrossDiff } from '@kira/git-core';
import type { GoToFileOutcome } from '@kira/git-ipc';
import type { ConnectionManager } from './connection.ts';
import { virtualKey } from './virtualKey.ts';

export interface GoToFileDeps {
  readonly connection: ConnectionManager;
  readonly editor: EditorIntegration;
}

export async function goToFile(
  deps: GoToFileDeps,
  params: { repoId: string; rev: string; path: string; line: number },
  signal?: AbortSignal,
): Promise<GoToFileOutcome> {
  const { connection, editor } = deps;
  const { repoId, rev, path, line } = params;
  const target = await connection.request('file.goToTarget', { repoId, rev, path }, signal);
  switch (target.kind) {
    case 'live': {
      const finalLine = target.hunks !== null ? mapLineAcrossDiff(target.hunks, line, 'old') : line;
      await editor.reveal({ kind: 'file', path: target.absPath }, finalLine);
      return { kind: 'liveFile', path, line: finalLine };
    }
    case 'historical': {
      await editor.reveal(
        {
          kind: 'virtual',
          key: virtualKey(repoId, target.rev, target.path),
          label: basename(target.path),
        },
        line,
      );
      return { kind: 'virtualBlob', path: target.path, rev: target.rev, line };
    }
    case 'unavailable':
      return target;
  }
}
