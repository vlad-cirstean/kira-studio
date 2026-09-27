import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import type { DialogSpec } from '../dialogCompose';

// P129 Part 3 §0.9/§2.5: the `ade` module's own runtime UI state — active repo tab and the
// per-repo Refresh note (§0.16's "the note persists, runtime, per repo, until the next Refresh").
// Selection (`selectedByRepo`) lands with Part 5's timeline click, `historyOpen` with the same
// part — neither exists yet. P129 Part 4 adds dialog state: the one `AdeClaudeDialog` open across
// every repo, never two at once (mockup's own single `state.dialog`).
export type AdeRefreshNote =
  | { kind: 'ok'; refsChanged: number; newlyMerged: string[] }
  | { kind: 'error'; message: string };

/** §2.5: `dialogCompose.ts`'s own `DialogState` plus the spec it was opened with and an in-dialog
 *  delivery error (§0.17) — `AdeClaudeDialog.vue` reads this whole. */
interface AdeDialogState {
  spec: DialogSpec;
  msg: string | null;
  push: boolean;
  override: boolean;
  branchName: string;
  error: string | null;
}

export const useAdeUiStore = defineStore('adeUi', () => {
  const state = reactive({
    /** Runtime only, never persisted (§0.15) — defaults to the first imported repo at the call
     *  site (`AdeView.vue`), not here, so this store stays ignorant of `codeReposStore`. */
    activeRepoId: '' as string,
    refreshNote: {} as Record<string, AdeRefreshNote>,
    dialog: null as AdeDialogState | null,
  });

  function setActiveRepo(id: string): void {
    state.activeRepoId = id;
  }

  function recordRefresh(codeRepoId: string, note: AdeRefreshNote): void {
    state.refreshNote = { ...state.refreshNote, [codeRepoId]: note };
  }

  /** §0.10: every open resets the dialog's own scratch state (mockup `openDialog`, plus
   *  `startDialog`'s own `dialogBranch: ''`) — an override, edit or push choice from a previous
   *  dialog never carries into the next one. */
  function openDialog(spec: DialogSpec): void {
    state.dialog = { spec, msg: null, push: false, override: false, branchName: '', error: null };
  }

  function closeDialog(): void {
    state.dialog = null;
  }

  function setMsg(v: string | null): void {
    if (state.dialog) state.dialog.msg = v;
  }

  function togglePush(): void {
    if (state.dialog) state.dialog.push = !state.dialog.push;
  }

  function toggleOverride(): void {
    if (state.dialog) state.dialog.override = !state.dialog.override;
  }

  function setBranchName(v: string): void {
    if (state.dialog) state.dialog.branchName = v;
  }

  function pickTarget(index: number, choice: string): void {
    const tg = state.dialog?.spec.targets[index];
    if (tg) tg.choice = choice;
  }

  function pickWorktree(wt: 'same' | 'new'): void {
    if (state.dialog) state.dialog.spec.wt = wt;
  }

  /** §0.12 step 12: a partial rebase/queue delivery failure trims the still-open spec down to the
   *  roots not yet sent, so a retry resends only the rest. */
  function dropRoots(sent: readonly string[]): void {
    const spec = state.dialog?.spec;
    if (!spec) return;
    if (spec.roots) spec.roots = spec.roots.filter((r) => !sent.includes(r));
    spec.targets = spec.targets.filter((t) => !sent.includes(t.item));
  }

  function setError(message: string): void {
    if (state.dialog) state.dialog.error = message;
  }

  return {
    ...toRefs(state),
    setActiveRepo,
    recordRefresh,
    openDialog,
    closeDialog,
    setMsg,
    togglePush,
    toggleOverride,
    setBranchName,
    pickTarget,
    pickWorktree,
    dropRoots,
    setError,
  };
});
