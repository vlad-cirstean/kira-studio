/**
 * `EditorIntegration` over VS Code's native diff and document APIs (P5 W5). Four details that
 * are the difference between this working and nearly working (`docs/plans/P5.md`'s W5):
 *
 * 1. The scheme is `kira-version`, registered once at activation and disposed with the
 *    extension. The URI is `kira-version:/<opaque key>/<basename>` — the key is opaque to VS
 *    Code and meaningful only to the registered `VirtualDocumentSource`; the *last* path segment
 *    is the real filename, because that is what VS Code resolves the language mode from.
 * 2. Content is cached by VS Code per URI and never invalidated: a `<rev>:<path>` blob is
 *    immutable, so this provider fires no `onDidChange` and needs no emitter.
 * 3. `vscode.diff` is given two virtual (or empty) URIs for every *historical* diff — both sides
 *    of a commit-to-commit comparison are historical, so neither is ever the live working file.
 *    P7 (item 2) is the one deliberate exception: the uncommitted-changes strip's own diff has a
 *    genuinely live right-hand side by definition, so `editor.openWorkingDiff`
 *    (`proxyHandlers.ts`) is the first caller to pass `openDiff` a `{kind: 'file'}` `DocumentRef` —
 *    `toUri`'s own `'file'` case already existed for `reveal` (`goToFile.ts`), just never fed into
 *    a diff before now.
 * 4. `capabilities` is the constant below; `resolveConflict` (§7.11, D15) is two commands and no
 *    UI of ours — `workbench.view.scm` to reveal the SCM view, then `vscode.open` on the
 *    conflicted file, which is what routes it into the three-way merge editor when the user has
 *    it enabled and into `merge-conflict`'s inline decorations when they do not. We choose
 *    neither; both are the user's own configuration, and picking for them would be exactly the
 *    reimplementation §7.11 forbids.
 */
import type {
  Disposable,
  DocumentRef,
  EditorCapabilities,
  EditorIntegration,
  VirtualDocumentSource,
} from '@kira/git-core';
import * as vscode from 'vscode';
import { decodeKey, encodeKey } from '../virtualKey.ts';

// Exported (G13 D9) so reviewComments.ts's commentingRangeProvider and its own document-uri
// builder use the exact same scheme literal — never a second copy that could drift.
export const SCHEME = 'kira-version';
/** The first path segment reserved for the "empty" side of an add/delete diff. `.` is not in
 *  base64url's alphabet (G12 D11), so this can never collide with a real encoded key — unlike the
 *  bare `empty` it replaces, which relied only on a real key always containing a `/`.
 *  Exported (G19 D9) so `virtualFileDecoration.ts`'s own `FileDecorationProvider` recognises and
 *  skips this segment the identical way `provideTextDocumentContent` above already does — never a
 *  second literal that could drift. */
export const EMPTY_SEGMENT = '.empty';

/** Exported (G19 D9) so `virtualFileDecoration.ts` recovers a URI's own key segment the identical
 *  way this file's `provideTextDocumentContent` already does — never a second parsing rule. */
export function pathSegments(uri: vscode.Uri): readonly string[] {
  return uri.path.split('/').filter((segment) => segment.length > 0);
}

function toUri(ref: DocumentRef): vscode.Uri {
  switch (ref.kind) {
    case 'file':
      return vscode.Uri.file(ref.path);
    case 'empty':
      return vscode.Uri.parse(`${SCHEME}:/${EMPTY_SEGMENT}/${encodeURIComponent(ref.label)}`);
    case 'virtual':
      // G12 D11: base64url, not percent-encoding — see virtualKey.ts's own doc comment.
      return vscode.Uri.parse(`${SCHEME}:/${encodeKey(ref.key)}/${encodeURIComponent(ref.label)}`);
  }
}

export class VsCodeEditorIntegration implements EditorIntegration {
  readonly capabilities: EditorCapabilities = {
    openInEditor: true,
    goToFile: true,
    resolveConflict: true,
  };
  #source: VirtualDocumentSource | undefined;
  /** G21 D8b: `vscode.changes` is a built-in command with no entry in `@types/vscode` (F8) — a
   *  real capability probe rather than a version assumption, and memoized (`getCommands(true)` is
   *  not free) since this extension's own lifetime never sees the host gain or lose a built-in
   *  command. `undefined` until the first `openAllChanges` call resolves it. */
  #hasMultiDiffCommand: Promise<boolean> | undefined;

  registerVirtualDocuments(source: VirtualDocumentSource): Disposable {
    this.#source = source;
    const provider: vscode.TextDocumentContentProvider = {
      provideTextDocumentContent: async (uri) => {
        const segments = pathSegments(uri);
        const first = segments[0];
        if (first === undefined || first === EMPTY_SEGMENT) return '';
        // A malformed segment (not valid base64url, or a key parseVirtualKey rejects) resolves to
        // an empty document via #source?.provide returning undefined below — never a thrown
        // provider (G12 D11).
        const content = await this.#source?.provide(decodeKey(first));
        return content ?? '';
      },
    };
    const registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider);
    return {
      dispose: () => {
        registration.dispose();
        this.#source = undefined;
      },
    };
  }

  async openDiff(req: {
    left: DocumentRef;
    right: DocumentRef;
    title: string;
    pinned: boolean;
    /** G21 D8b: internal-only — `openAllChanges`'s own sequenced fallback sets this on every file
     *  but the last, so opening N tabs steals focus once, not N times. Not part of the
     *  `EditorIntegration` port's own public signature; no other caller ever sets it. */
    preserveFocus?: boolean;
  }): Promise<void> {
    // G19 D8: a real, non-preview tab, for a caller that wants one — F8 root-caused "Open all
    // changes" only ever leaving the last file's diff open to this one missing options argument.
    // With no fourth argument, VS Code opens every diff in the same single preview tab, so a
    // sequential loop over every changed file just keeps replacing that one tab. `{ preview:
    // false }` pins each call's own tab, so N files opened in a loop leave N tabs open, not one.
    // Kept, unchanged, for `req.pinned === true` (the bulk "Open all changes" fallback path, D8,
    // and an explicit double-click/Enter, D13).
    //
    // G21 D13: `req.pinned === false` (a single click — navigational) omits the options argument
    // entirely instead. This is deliberately not `{ preview: true }`: passing that argument at
    // all would *force* preview mode even for a user who has turned `workbench.editor.
    // enablePreview` off globally, fighting their own setting. Omitting the argument lets VS
    // Code's own default *and* that setting govern, which is what "matches VS Code's own
    // convention" actually means here.
    if (req.pinned) {
      await vscode.commands.executeCommand(
        'vscode.diff',
        toUri(req.left),
        toUri(req.right),
        req.title,
        {
          preview: false,
          ...(req.preserveFocus ? { preserveFocus: true } : {}),
        } satisfies vscode.TextDocumentShowOptions,
      );
    } else {
      await vscode.commands.executeCommand(
        'vscode.diff',
        toUri(req.left),
        toUri(req.right),
        req.title,
      );
    }
  }

  /** G21 D8b (item 8): probes `vscode.changes` once and prefers it — one call opens every file's
   *  hunks in the host's own multi-file diff editor, which is what item 8's own wording ("doesn't
   *  show all files' hunks") actually asks for, not N separate tabs. Falls back to the sequenced,
   *  error-aware per-file loop this extension already had (via `openDiff`, `pinned: true`) when
   *  the command is absent or the call itself rejects — strictly better than the old loop either
   *  way (one `commit.detail` round trip already, `proxyHandlers.ts`'s own composition; here,
   *  `preserveFocus` on every file but the last so opening N tabs steals focus once). */
  async openAllChanges(req: {
    title: string;
    files: readonly { left: DocumentRef; right: DocumentRef; resource: string }[];
  }): Promise<{ opened: number; failed: number; mode: 'multiDiff' | 'tabs' }> {
    if (this.#hasMultiDiffCommand === undefined) {
      // `vscode.commands.getCommands` returns a `Thenable`, not a real `Promise` — wrapped so
      // `#hasMultiDiffCommand`'s own type (and every later `await`) is an ordinary `Promise`.
      this.#hasMultiDiffCommand = Promise.resolve(
        vscode.commands.getCommands(true).then((commands) => commands.includes('vscode.changes')),
      );
    }
    if (await this.#hasMultiDiffCommand) {
      try {
        const resources = req.files.map(
          (file) => [vscode.Uri.file(file.resource), toUri(file.left), toUri(file.right)] as const,
        );
        await vscode.commands.executeCommand('vscode.changes', req.title, resources);
        return { opened: req.files.length, failed: 0, mode: 'multiDiff' };
      } catch {
        // Falls through to the sequenced loop below — an absent or renamed command (or any other
        // rejection) degrades instead of throwing (F8's own reasoning for probing at all).
      }
    }

    let opened = 0;
    let failed = 0;
    for (const [index, file] of req.files.entries()) {
      try {
        await this.openDiff({
          left: file.left,
          right: file.right,
          title: req.title,
          pinned: true,
          preserveFocus: index < req.files.length - 1,
        });
        opened++;
      } catch {
        failed++;
      }
    }
    return { opened, failed, mode: 'tabs' };
  }

  async reveal(ref: DocumentRef, line: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(toUri(ref));
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(position, position),
    });
  }

  async resolveConflict(req: { readonly path: string }): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.scm');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(req.path));
  }
}
