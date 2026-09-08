/**
 * G19 D9 (item 9): a `vscode.FileDecorationProvider` for the `kira-version:` scheme (F9 —
 * previously none existed at all, `grep registerFileDecorationProvider` returned zero hits).
 * Badges a virtual document — a historical revision of a tracked file, opened read-only through
 * `ports/editorIntegration.ts`'s own `registerVirtualDocuments` — with a lock icon only when the
 * *live* worktree no longer has anything at that path (a file deleted, or renamed away, since the
 * revision being viewed). `virtualKey.ts`'s own `{repoId, rev, path}` is already recoverable from
 * any such URI, and `repoId` is the worktree's absolute root (G3 D7), so the live-disk check is a
 * plain `vscode.workspace.fs.stat` against `repoId`/`path` — no new RPC, no server round trip.
 *
 * `'empty'`-kind placeholders (`EMPTY_SEGMENT`, the blank side of an add/delete diff) are skipped
 * outright — self-evidently blank, never a "this used to exist" case. Content behind this scheme
 * is immutable per URI (`editorIntegration.ts`'s own doc comment point 2), so this provider's own
 * `onDidChangeFileDecorations` emitter is real (the interface requires one) but never fires —
 * there is nothing that would ever need to invalidate a decoration once computed.
 */
import * as vscode from 'vscode';
import { EMPTY_SEGMENT, pathSegments, SCHEME } from './ports/editorIntegration.ts';
import { decodeKey, parseVirtualKey } from './virtualKey.ts';

export class KiraVirtualFileDecorationProvider implements vscode.FileDecorationProvider {
  readonly #onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.#onDidChange.event;

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== SCHEME) return undefined;
    const first = pathSegments(uri)[0];
    if (first === undefined || first === EMPTY_SEGMENT) return undefined;

    let parsed: ReturnType<typeof parseVirtualKey>;
    try {
      parsed = parseVirtualKey(decodeKey(first));
    } catch {
      return undefined;
    }
    if (!parsed) return undefined;

    const liveUri = vscode.Uri.joinPath(vscode.Uri.file(parsed.repoId), parsed.path);
    return vscode.workspace.fs.stat(liveUri).then(
      // The path still exists on disk — this revision is not the last trace of it.
      () => undefined,
      () => ({
        badge: '🔒',
        tooltip: 'This path no longer exists in the working tree',
      }),
    );
  }

  dispose(): void {
    this.#onDidChange.dispose();
  }
}
