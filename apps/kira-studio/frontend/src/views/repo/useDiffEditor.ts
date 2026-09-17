// P92 item 5: RepoDiffView.vue's own content-resolution + editor-construction body, extracted so
// RepoMultiDiffView.vue's own per-file sections can share one implementation instead of a second
// copy — CLAUDE.md's "one term per concept" rule. Registered under `editorKey` (editors.ts's own
// registry key, an opaque string) rather than a plain tabId: a single-file diff (RepoDiffView.vue)
// passes its tab id unchanged, byte-identical to before this phase; one section of a multi-diff
// tab (RepoMultiDiffView.vue) passes `${tabId}:${path}`, since one multi-diff tab registers
// several model pairs under the one tab id (§7.3's own note).
//
// Deliberately NOT here: `view.find`/`repo.goToFileFromDiff` command registration and review-
// decorations wiring (attachReviewDecorations) — both are single-active-view concerns RepoDiffView
// still owns; registering either once per expanded multi-diff section would mean the last section
// mounted wins, silently shadowing the others'.
import type { DiffSide } from '@shared/domain/repo';
import { type Ref, ref } from 'vue';
import { control } from '../../bridge/control';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';
import { openRepoFileTab } from '../../state/repoTabs';
import { settingsState } from '../../state/settings';
import { registerDiffEditor, unmountEditor } from './editors';
import { monacoLanguageFor } from './language';
import {
  getOrCreateModel,
  loadMonaco,
  REPO_THEME_NAME,
  repoDiffUris,
  repoRevisionDiffUris,
} from './monaco';
import { ensureNavigationRegistered } from './navigation';

// C10 §6.1: file.read's own four-way result, reshaped into DiffSide — the same classification
// codeWorkspaceReadDiff's own two sides already use, so the binary/tooLarge/bothMissing branches
// below and the Monaco model creation stay one implementation for both kinds of diff.
function toDiffSide(result: {
  readonly kind: 'found' | 'missing' | 'binary' | 'tooLarge';
  readonly content?: string;
  readonly bytes?: number;
  readonly limitBytes?: number;
}): DiffSide {
  return {
    kind: result.kind,
    text: result.content ?? '',
    bytes: result.bytes ?? 0,
    limitBytes: result.limitBytes ?? 0,
  };
}

export type DiffEditorState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';

export interface DiffEditorParams {
  /** editors.ts's own registry key — see this file's own header comment. */
  editorKey: string;
  /** Already resolved from the tab's own workspaceId — a missing repository is the caller's own
   *  error state to show (nothing to mount at all), not this composable's. */
  repoId: string;
  path: string;
  /** C10 §6.1/§6.2: both null is C6's original HEAD-vs-worktree comparison; a commit diff always
   *  supplies both (a root commit's left is git's well-known empty-tree sha, never null). */
  left: string | null;
  right: string | null;
  /** Only toggles hideUnchangedRegions/glyphMargin (§7.3 gotchas 1/2) — the review object itself,
   *  and attaching its comment-thread layer, stay the caller's own concern. */
  review: boolean;
}

export interface DiffEditorHandle {
  state: Ref<DiffEditorState>;
  errorMessage: Ref<string>;
  /** Set once mount() reaches 'found' — RepoDiffView.vue's own view.find/review-decorations
   *  wiring, both single-active-view concerns this composable deliberately stays out of (this
   *  file's own header comment), reach the live editor through it. */
  editor: Ref<import('monaco-editor').editor.IStandaloneDiffEditor | null>;
  mount(): Promise<void>;
  /** onUnmounted — disposes the widget only; the model(s) survive in editors.ts (unmountEditor's
   *  own contract) until dropResources actually closes the tab. */
  dispose(): void;
  /** A no-op before mount() reaches 'found' or after dispose(). */
  goToFile(): void;
}

// §11: read-only, unchanged from the file viewer — readOnly/domReadOnly block the keyboard and
// paste; renderMarginRevertIcon/renderGutterMenu are the second layer, hiding the revert/apply
// affordances that would otherwise let a user trigger a write from a widget built for the
// extension's read-write use (C6 §8.1, not cosmetic).
export function useDiffEditor(
  container: Ref<HTMLElement | null>,
  params: DiffEditorParams,
): DiffEditorHandle {
  const state = ref<DiffEditorState>('loading');
  const errorMessage = ref('');
  const editor = ref<import('monaco-editor').editor.IStandaloneDiffEditor | null>(null);
  let goToFileImpl: (() => void) | null = null;

  async function mount(): Promise<void> {
    const { editorKey, repoId, path, left, right, review } = params;
    let gitRepoId: string | undefined;
    let diff: { head: DiffSide; worktree: DiffSide };
    if (left === null) {
      try {
        diff = await control.codeWorkspaceReadDiff(repoId, path);
      } catch (err) {
        state.value = 'error';
        errorMessage.value = err instanceof Error ? err.message : String(err);
        return;
      }
    } else {
      gitRepoId = gitRepoIdFor(repoId);
      if (!gitRepoId || right === null) {
        state.value = 'error';
        errorMessage.value = 'This repository is not open.';
        return;
      }
      // 7d (P68 review): this lease is only ever used for the two requests below, so it is
      // released as soon as they settle rather than left to leak for the rest of the mount.
      const transport = gitTransportFor(repoId);
      try {
        const [leftResult, rightResult] = await Promise.all([
          transport.request('file.read', { repoId: gitRepoId, rev: left, path }),
          transport.request('file.read', { repoId: gitRepoId, rev: right, path }),
        ]);
        diff = { head: toDiffSide(leftResult), worktree: toDiffSide(rightResult) };
      } catch (err) {
        state.value = 'error';
        errorMessage.value = err instanceof Error ? err.message : String(err);
        return;
      } finally {
        transport.dispose();
      }
    }

    if (diff.head.kind === 'binary' || diff.worktree.kind === 'binary') {
      state.value = 'binary';
      return;
    }
    if (diff.head.kind === 'tooLarge' || diff.worktree.kind === 'tooLarge') {
      state.value = 'tooLarge';
      return;
    }
    if (diff.head.kind === 'missing' && diff.worktree.kind === 'missing') {
      state.value = 'bothMissing';
      return;
    }

    const mod = await loadMonaco();
    ensureNavigationRegistered(mod);
    // Unmounted (tab closed/switched away, or the section collapsed) while the read/import above
    // was in flight.
    if (!container.value) return;

    let headUri: import('monaco-editor').Uri;
    let worktreeUri: import('monaco-editor').Uri;
    if (left === null) {
      ({ head: headUri, worktree: worktreeUri } = repoDiffUris(mod, repoId, path));
    } else {
      ({ left: headUri, right: worktreeUri } = repoRevisionDiffUris(
        mod,
        repoId,
        path,
        left,
        // biome-ignore lint/style/noNonNullAssertion: checked alongside left above — both null or both set.
        right!,
      ));
    }
    const language = monacoLanguageFor(path);
    // D7: the HEAD side is deliberately never recorded as navigable — its content is a different
    // revision than the index describes, so answering a definition there would be a lie. The
    // worktree side is, since it's byte-identical to what the index parsed. C10: for a commit
    // diff, NEITHER side is on disk, so neither is registered — this extends D7's own rule rather
    // than special-casing it.
    const original = getOrCreateModel(mod, headUri.toString(), diff.head.text, language);
    const modified = getOrCreateModel(
      mod,
      worktreeUri.toString(),
      diff.worktree.text,
      language,
      left === null ? { repoId, path } : undefined,
    );

    const created = mod.editor.createDiffEditor(container.value, {
      theme: REPO_THEME_NAME,
      readOnly: true,
      domReadOnly: true,
      originalEditable: false,
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      automaticLayout: true,
      renderSideBySide: true,
      ignoreTrimWhitespace: false,
      // C11 §7.3 gotcha 2: 0.56.0 has no public API to expand one specific collapsed unchanged
      // region, so a comment anchored inside one would be invisible — only the review variant
      // disables this; C6/C10's plain diff keeps it enabled, byte-identical.
      hideUnchangedRegions: { enabled: !review },
      // §7.3 gotcha 1: the registered option default and the .d.ts prose disagree — set explicitly
      // for the review variant rather than depend on either being right in a future Monaco bump.
      // The plain diff passes nothing, unchanged from before this phase.
      ...(review ? { glyphMargin: true } : {}),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // P78 §8.3: RepoFileView.vue's own identical options, same reasoning.
      gotoLocation: {
        multipleDefinitions: 'goto',
        multipleReferences: 'peek',
        multipleImplementations: 'peek',
      },
      fontFamily: settingsState.appearance.fontFamily,
      fontSize: settingsState.appearance.fontSize,
    });
    created.setModel({ original, modified });
    registerDiffEditor(editorKey, [headUri.toString(), worktreeUri.toString()], created);
    editor.value = created;

    // C7 D13/§6: the modified (worktree) pane, never the HEAD pane — it's the side whose content
    // matches the file on disk (C6 D7's own reasoning for which side is navigable), and
    // IStandaloneDiffEditor itself has no getAction, so this has to reach through to one pane.
    const modifiedEditor = created.getModifiedEditor();

    // P74 §7.4 item 1 / P92 item 7: the diff editor's own "go to file" — a revision-backed diff
    // resolves the target through the git transport; C6's plain worktree-vs-HEAD comparison
    // already shows the live file on disk (right === null), so the modified pane *is* that file —
    // open it directly, no round trip.
    goToFileImpl = () => {
      const line = modifiedEditor.getPosition()?.lineNumber ?? 1;
      if (gitRepoId === undefined || right === null) {
        openRepoFileTab(repoId, path, { preview: false, reveal: { line } });
        return;
      }
      const targetGitRepoId = gitRepoId;
      const targetRev = right;
      const transport = gitTransportFor(repoId);
      transport
        .request('editor.goToFile', { repoId: targetGitRepoId, rev: targetRev, path, line })
        .then((outcome) => {
          // `liveFile`/`virtualBlob` already opened their own tab (hostHandlers.ts's own
          // composition) — the tab switch is the visible confirmation. `unavailable` is the one
          // branch with no other signal; this raw editor view has no toast/live-region channel to
          // surface it through, so it goes to the console rather than dropping silently.
          if (outcome.kind === 'unavailable') {
            console.warn(`repo.goToFileFromDiff: ${path} unavailable — ${outcome.reason}`);
          }
        })
        .catch((err: unknown) => {
          console.warn('repo.goToFileFromDiff failed:', err);
        })
        .finally(() => transport.dispose());
    };

    state.value = 'found';
  }

  function dispose(): void {
    goToFileImpl = null;
    editor.value = null;
    unmountEditor(params.editorKey);
  }

  function goToFile(): void {
    goToFileImpl?.();
  }

  return { state, errorMessage, editor, mount, dispose, goToFile };
}
