// P94 pass 3 §4.3, shape 4 second pattern (a "fat" mount-time block owning real Vue lifecycle —
// two watches plus a status-bar publish subscription): extracted as a composable, not a plain
// function, because it owns that lifetime itself — `attach()` starts it, `dispose()` (called from
// RepoFileView.vue's own onUnmounted) tears it down, mirroring the original inline
// create-then-cleanup pairing exactly.
import { watch } from 'vue';
import { gitTransportFor } from '../../repo/git/transport';
import { useBlameStatusStore } from '../../state/blameStatus';
import { useSettingsStore } from '../../state/settings';
import { attachBlameAnnotation, type BlameAnnotationHandle } from './blameAnnotation';
import { type BlameLineController, createBlameLineController } from './blameLine';
import type { MonacoModule } from './monaco';

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

interface InlineBlameAttachParams {
  gitRepoId: string;
  /** A fresh transport lease is opened for the blame controller itself — this is only the repo id
   *  it's leased against (`gitTransportFor`'s own key), never a transport to reuse. */
  workspaceRepoId: string;
  path: string;
  editor: StandaloneEditor;
  mod: MonacoModule;
}

export interface InlineBlameHandle {
  /** Starts blame resolution for this mount: one transport lease, the cursor-line controller
   *  (`blameLine.ts`), the status-bar publish subscription, and the inline decoration renderer
   *  toggled live off `settingsStore.appearance.inlineBlame` (§5.3 — the setting governs the
   *  renderer only; resolution and the status-bar publish run regardless). A no-op if called more
   *  than once without an intervening `dispose()`. */
  attach(params: InlineBlameAttachParams): void;
  /** Tears down everything `attach()` started — safe to call even when `attach()` never ran. */
  dispose(): void;
}

export function useInlineBlame(): InlineBlameHandle {
  const blameStatusStore = useBlameStatusStore();
  const settingsStore = useSettingsStore();
  let blameHandle: BlameAnnotationHandle | null = null;
  let blameController: BlameLineController | null = null;
  let blameToken: symbol | undefined;
  let stopBlamePublish: (() => void) | undefined;
  let unwatchInlineBlame: (() => void) | null = null;

  function attach({
    gitRepoId,
    workspaceRepoId,
    path,
    editor,
    mod,
  }: InlineBlameAttachParams): void {
    if (blameController) return;
    // 7d (moved, P76 §4/§5.3): one lease for this mount, shared by the controller and the reveal
    // callback below — blameLine.ts's controller has no transport of its own to release, so
    // whoever creates it disposes it.
    const transport = gitTransportFor(workspaceRepoId);
    blameController = createBlameLineController({ transport, gitRepoId, path, cursor: editor });
    // P76 §5.3: resolved even when `inlineBlame` is off, to feed the status bar — the setting
    // governs the inline annotation only (its own label: "…in the repository file viewer"),
    // never blame resolution itself.
    blameToken = blameStatusStore.claimBlameStatus((sha) => {
      void transport.request('graph.revealCommit', { repoId: gitRepoId, sha });
    });
    const controller = blameController;
    const token = blameToken;
    stopBlamePublish = watch(
      controller.state,
      (s) => blameStatusStore.publishBlameStatus(token, s),
      {
        immediate: true,
      },
    );

    function syncBlameAnnotation(): void {
      if (settingsStore.appearance.inlineBlame && blameController) {
        blameHandle ??= attachBlameAnnotation(mod, editor, blameController);
      } else {
        blameHandle?.dispose();
        blameHandle = null;
      }
    }
    syncBlameAnnotation();
    unwatchInlineBlame = watch(() => settingsStore.appearance.inlineBlame, syncBlameAnnotation);
  }

  function dispose(): void {
    unwatchInlineBlame?.();
    unwatchInlineBlame = null;
    blameHandle?.dispose();
    blameHandle = null;
    stopBlamePublish?.();
    stopBlamePublish = undefined;
    if (blameToken !== undefined) blameStatusStore.releaseBlameStatus(blameToken);
    blameToken = undefined;
    blameController?.dispose();
    blameController?.transport.dispose();
    blameController = null;
  }

  return { attach, dispose };
}
