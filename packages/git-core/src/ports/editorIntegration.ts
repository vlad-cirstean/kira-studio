/**
 * The host's native diff view and "reveal a line" capability (P5, §3.3: "the one port whose
 * contract is genuinely richer than a single call"). Describes a native diff, a reveal-at-a-line,
 * and a lazily-materialized read-only document — without knowing that git exists.
 *
 * `packages/host-vscode/src/ports/editorIntegration.ts` is the shipped implementation, over
 * `vscode.workspace.registerTextDocumentContentProvider`,
 * `vscode.commands.executeCommand("vscode.diff", …)` and
 * `window.showTextDocument(doc, { selection })`.
 */
import type { Disposable } from './disposable.ts';

export type DocumentRef =
  /** An absolute path on disk. */
  | { readonly kind: 'file'; readonly path: string }
  /** Content the app produces on demand; `label` is the filename the host shows, which is also
   *  what drives its syntax highlighting. */
  | { readonly kind: 'virtual'; readonly key: string; readonly label: string }
  /** The empty side of an add or a delete. */
  | { readonly kind: 'empty'; readonly label: string };

export interface VirtualDocumentSource {
  /** Resolves the text for a key previously handed to `openDiff`/`reveal`; `undefined` if it
   *  is no longer resolvable (the repo was closed). */
  provide(key: string): Promise<string | undefined>;
}

export interface EditorCapabilities {
  readonly openInEditor: boolean;
  readonly goToFile: boolean;
  /** P6/W10, §7.11. `true` under VS Code; `false` in the harness's default posture. A host with
   *  this `false` need not implement `resolveConflict` and is never called — see that method's
   *  own doc comment. */
  readonly resolveConflict: boolean;
}

export interface EditorIntegration {
  readonly capabilities: EditorCapabilities;
  /** Registered once, at activation. */
  registerVirtualDocuments(source: VirtualDocumentSource): Disposable;
  /** G21 D13: `pinned` is required, not optional — every caller (`proxyHandlers.ts`'s two
   *  `editor.*` handlers) decides it explicitly rather than a default hiding which behaviour a
   *  forgotten argument would silently get. `true` opens a real, permanent tab (G19 D8's own
   *  `{ preview: false }` fix, kept); `false` omits the underlying host option entirely so the
   *  host's own preview-tab convention (and a user's own preference) governs — see the shipped
   *  implementation's own doc comment for why that is not the same as passing `{ preview: true }`. */
  openDiff(req: {
    left: DocumentRef;
    right: DocumentRef;
    title: string;
    pinned: boolean;
  }): Promise<void>;
  /** Opens `ref` and puts the cursor on `line` (1-based). */
  reveal(ref: DocumentRef, line: number): Promise<void>;
  /** P6/W10, §7.11's "Resolve in VS Code": reveal the host's own SCM surface and open `path` in
   *  whatever conflict resolver it has — D15's whole point is that this app never reimplements
   *  one. Never called when `capabilities.resolveConflict` is `false`. */
  resolveConflict(req: { readonly path: string }): Promise<void>;
}
