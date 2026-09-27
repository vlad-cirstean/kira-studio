import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import type { DialogSpec } from '../dialogCompose';

// P129 Part 3 §0.9/§2.5: the `ade` module's own runtime UI state — active repo tab and the
// per-repo Refresh note (§0.16's "the note persists, runtime, per repo, until the next Refresh").
// P129 Part 4 adds dialog state: the one `AdeClaudeDialog` open across every repo, never two at
// once (mockup's own single `state.dialog`). P129 Part 5 §0.6 adds `selectedByRepo` (mockup's own
// `selected[repo]`) — it outlives an `AdeRepoView` repo-tab remount, unlike `historyOpen`, which
// stays a local ref on that component (§0.6's own reasoning).
export type AdeRefreshNote =
  | { kind: 'ok'; refsChanged: number; newlyMerged: string[] }
  | { kind: 'error'; message: string };

/** P129 Part 5 §0.11: one shared confirm prompt (day-off move, §0.16's protected-branch force push)
 *  — `AdeConfirmDialog.vue`'s own whole state. `token` non-null names the value its own `Input` must
 *  match before "yes" enables (the protected branch's own name); `run` is the caller's already-bound
 *  closure, awaited on "yes" — a rejection sets `error` and leaves the dialog open. */
export interface AdeConfirmState {
  title: string;
  text: string;
  yesLabel: string;
  noLabel: string;
  token: string | null;
  error: string | null;
  run: () => Promise<void>;
}

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
    /** §0.6: the timeline's own row selection, per repo — `useQueue`'s own first-item default
     *  applies when a repo has no entry here, or its entry no longer names a live item. */
    selectedByRepo: {} as Record<string, string>,
    confirm: null as AdeConfirmState | null,
    /** P129 Part 6 §0.20: the detail panel's own tab (mockup `state.tab`) — one across every repo,
     *  like `dialog`, not per-repo (switching repo tabs keeps the same panel tab selected). */
    panelTab: 'details' as 'details' | 'changes' | 'agents',
    /** P129 Part 6 §0.20: the Agents tab's own terminal-tab pick (mockup `state.termTab`), keyed
     *  `${repo}:${item}` -> session record id — `AdeAgentsTab.vue` falls back to the first running
     *  session when an item has no entry, or its entry names a session no longer running. */
    agentTabByItem: {} as Record<string, string>,
  });

  function setActiveRepo(id: string): void {
    state.activeRepoId = id;
  }

  function select(codeRepoId: string, id: string): void {
    state.selectedByRepo = { ...state.selectedByRepo, [codeRepoId]: id };
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

  /** §0.11: every open replaces whatever confirm was showing (the mockup's own single
   *  `state.confirm`) and resets `error`, mirroring `openDialog`'s own reset-on-open rule. */
  function openConfirm(c: Omit<AdeConfirmState, 'error'>): void {
    state.confirm = { ...c, error: null };
  }

  function closeConfirm(): void {
    state.confirm = null;
  }

  function setConfirmError(message: string): void {
    if (state.confirm) state.confirm.error = message;
  }

  function setPanelTab(tab: 'details' | 'changes' | 'agents'): void {
    state.panelTab = tab;
  }

  function setAgentTab(codeRepoId: string, item: string, sessionId: string): void {
    state.agentTabByItem = { ...state.agentTabByItem, [`${codeRepoId}:${item}`]: sessionId };
  }

  /** P129 Part 6 §0.21: the activity icon's own hand-off — select the item, switch to the Agents
   *  tab, and pick that session's own terminal tab, in one call. */
  function openSession(codeRepoId: string, item: string, sessionId: string): void {
    select(codeRepoId, item);
    state.panelTab = 'agents';
    setAgentTab(codeRepoId, item, sessionId);
  }

  return {
    ...toRefs(state),
    setActiveRepo,
    select,
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
    openConfirm,
    closeConfirm,
    setConfirmError,
    setPanelTab,
    setAgentTab,
    openSession,
  };
});
