/**
 * G14 D9/D10 — the review diff editor's own toolbar: `kiraVersion.goToFileFromDiff` ("Go to
 * file", item 7) and `kiraVersion.openCommitInGraph` ("Open in graph", item 8), both contributed
 * to `editor/title`, `when: isInDiffEditor && resourceScheme == kira-version`, placed left of VS
 * Code's own next/previous-change navigation via `navigation@-99`/`navigation@-98`.
 *
 * Both resolve *which document* the same way: `vscode.window.tabGroups.activeTabGroup.activeTab`
 * — never `activeTextEditor`, since a diff editor's "active editor" is whichever pane has focus
 * and may be neither when the click comes from the toolbar itself (F11) — narrowed to
 * `TabInputTextDiff`, then its `original`/`modified` URI resolved through the exact two lines
 * `reviewComments.ts`'s own `reviewAnchorFor` opens with (`decodeKey` + `parseVirtualKey`, G13
 * D20's seam). `resolveVirtualUri` below is that same resolution, generalised to either side (not
 * only the branch-tip fourth field `reviewAnchorFor` itself reads).
 *
 * "Go to file" reuses G4's own `file.goToTarget` + `mapLineAcrossDiff` composition —
 * `goToFile.ts`'s `goToFile`, `proxyHandlers.ts`'s `editor.goToFile` handler body lifted into an
 * exported function both this file and that one call, never a second implementation of the same
 * line arithmetic (G4 D11's own warning, quoted in F12). It lives in its own file, not this one,
 * so that `proxyHandlers.ts` — which never imports `vscode` — does not have to import this file's
 * own `vscode.window.tabGroups`/`vscode.TabInputTextDiff` usage along with it.
 *
 * "Open in graph" needs no G4 capability at all: it only names a commit, so it goes straight to
 * `KiraGraphViewProvider.runUiAction('revealCommit', {repoId, sha})` (D10) — the extension's own
 * route into an already-mounted (or cold) graph webview, the same one every palette command uses.
 * It also accepts an explicit `{repoId, sha}` argument, bypassing tab resolution entirely — this
 * is what lets `ReviewCommitRow.vue`'s own "Open in graph" hover action (D8 row 2) reach this same
 * command through a `command:` URI (`reviewView.ts`'s `enableCommandUris`) without a new bridge
 * request: VS Code's command-URI mechanism is not part of the RPC contract, so D8 stays true to
 * its own "no RPC changes" fence while still routing through this one real implementation.
 */
import type { EditorIntegration } from '@kira/git-core';
import * as vscode from 'vscode';
import type { ConnectionManager } from './connection.ts';
import { goToFile } from './goToFile.ts';
import type { KiraGraphViewProvider } from './panelView.ts';
import { SCHEME } from './ports/editorIntegration.ts';
import { decodeKey, parseVirtualKey } from './virtualKey.ts';

export interface DiffToolbarDeps {
  readonly connection: ConnectionManager;
  readonly editor: EditorIntegration;
  readonly graphProvider: KiraGraphViewProvider;
}

/** The URI shape both `editor.openDiff` and `editor.openRangeDiff` mint (`ports/
 *  editorIntegration.ts`'s `toUri`): `kira-version:/<encoded-key>/<label>`. Resolves either side
 *  of a diff to `{repoId, rev, path}` — `reviewAnchorFor`'s own two opening lines (F11), reused
 *  here rather than re-derived. `undefined` for the `.empty` side (an added/deleted file's other
 *  half) or any URI this scheme did not mint. */
function resolveVirtualUri(
  uri: vscode.Uri,
): { repoId: string; rev: string; path: string } | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const [first] = uri.path.split('/').filter((segment) => segment.length > 0);
  if (first === undefined) return undefined;
  const parsed = parseVirtualKey(decodeKey(first));
  if (!parsed) return undefined;
  return { repoId: parsed.repoId, rev: parsed.rev, path: parsed.path };
}

/** The diff tab currently active — never `vscode.window.activeTextEditor`, whose own "active
 *  editor" is whichever pane has focus and may be neither when the click comes from the toolbar
 *  itself (F11). `undefined` when the active tab is not a text diff at all (the `when` clause
 *  already restricts the button to exactly this case, but a command can still be invoked from the
 *  palette). */
function activeDiffTab(): vscode.TabInputTextDiff | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputTextDiff ? input : undefined;
}

/** Which side of the diff the resolution below prefers: the one the focused editor's own document
 *  actually is, when that editor is one of the diff's two panes; otherwise `modified` (D9 point
 *  2), since that is the side a user reading a diff top-to-bottom is usually looking at. */
function preferredSide(tab: vscode.TabInputTextDiff): vscode.Uri {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (
    active &&
    (active.toString() === tab.original.toString() || active.toString() === tab.modified.toString())
  ) {
    return active;
  }
  return tab.modified;
}

/** D9 point 3: the line is the focused editor's own cursor line when that editor is the chosen
 *  side, else line 1 — there is no meaningful cursor position to carry over from the *other*
 *  side of the diff. */
function currentLine(chosenUri: vscode.Uri): number {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.toString() === chosenUri.toString()) {
    return editor.selection.active.line + 1;
  }
  return 1;
}

/** `kiraVersion.goToFileFromDiff` (D9, item 7) — reuses G4's existing line-mapped "go to file"
 *  capability, which already answers `live` (with drift hunks, mapped) or `historical` (the
 *  `kira-version:` blob revealed at the line), exactly item 7's "works for historical/non-checked-
 *  out content too". */
export function goToFileFromDiffCommand(deps: DiffToolbarDeps): () => void {
  return () => {
    void (async () => {
      const tab = activeDiffTab();
      if (!tab) return;
      const chosen = preferredSide(tab);
      const resolved = resolveVirtualUri(chosen);
      if (!resolved) {
        await vscode.window.showInformationMessage(
          "Kira Version: this side of the diff has no file to go to (it's empty, or not one of " +
            "this diff's revisions).",
        );
        return;
      }
      const line = currentLine(chosen);
      const outcome = await goToFile(deps, { ...resolved, line });
      if (outcome.kind === 'unavailable') {
        const reason =
          outcome.reason === 'binary'
            ? 'the file is binary'
            : outcome.reason === 'tooLarge'
              ? 'the file is too large'
              : "the file doesn't exist at that revision";
        await vscode.window.showInformationMessage(`Kira Version: can't go to file — ${reason}.`);
      }
    })();
  };
}

/** `kiraVersion.openCommitInGraph` (D10, item 8) — reveals and selects a commit in the graph
 *  webview. `explicit`, when given (a `command:` URI invocation — see this file's own doc
 *  comment), names the commit directly and skips tab resolution entirely; the editor/title
 *  invocation (no args) resolves it from the active diff tab exactly like `goToFileFromDiff`
 *  above, except only `repoId`/`rev` matter here — `rev` is already the commit sha, on both
 *  sides `editor.openDiff`/`editor.openRangeDiff` ever mint. */
export function openCommitInGraphCommand(deps: DiffToolbarDeps): (explicit?: unknown) => void {
  return (explicit?: unknown) => {
    const fromArg = asExplicitTarget(explicit);
    if (fromArg) {
      deps.graphProvider.runUiAction('revealCommit', fromArg);
      return;
    }
    const tab = activeDiffTab();
    if (!tab) return;
    const resolved = resolveVirtualUri(preferredSide(tab));
    if (!resolved) {
      void vscode.window.showInformationMessage(
        "Kira Version: this side of the diff isn't a commit (it's empty).",
      );
      return;
    }
    deps.graphProvider.runUiAction('revealCommit', { repoId: resolved.repoId, sha: resolved.rev });
  };
}

function asExplicitTarget(value: unknown): { repoId: string; sha: string } | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'repoId' in value &&
    'sha' in value &&
    typeof (value as { repoId: unknown }).repoId === 'string' &&
    typeof (value as { sha: unknown }).sha === 'string'
  ) {
    return { repoId: (value as { repoId: string }).repoId, sha: (value as { sha: string }).sha };
  }
  return undefined;
}
