import { queryClient } from '@workbench/state/queryClient';
import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import { useTerminalsStore } from '../../state/terminals';
import type { DialogCtx } from '../dialogCompose';
import {
  justDeleteArchive as runJustDeleteArchive,
  requestArchive as runRequestArchive,
  sendDialog as runSendDialog,
  type SendDialogDeps,
} from '../dialogFlow';
import type { LaunchDeps } from '../launch';
import {
  fetchArchiveRisk,
  useAdeAddBranch,
  useAdeAddDependency,
  useAdeAddNewWork,
  useAdeArchive,
  useAdeForcePush,
  useAdeLaunch,
  useAdeSend,
  useAdeSetPlan,
  useAdeSetQueuedAfter,
  useAdeUpdateNewWork,
} from '../mutations';
import type { SetPlanArgs } from '../timelineOps';
import { adeTurns } from '../turnWatch';
import type { AdeAddDependencyArgs, AdeAddNewWorkArgs } from '../wire';
import { useAdeTerminalsStore } from './adeTerminals';
import { useAdeUiStore } from './adeUi';
import { useAgentSessionsStore } from './agentSessions';

// P129 Part 4 §2.1/§2.5: in-flight agent actions — a separate concern from `adeUi`'s own dialog
// state (CLAUDE.md's own Pinia rule: one store, one concern).
export const useAdeActionsStore = defineStore('adeActions', () => {
  const adeUiStore = useAdeUiStore();
  const agentSessionsStore = useAgentSessionsStore();
  const terminalsStore = useTerminalsStore();
  const adeTerminalsStore = useAdeTerminalsStore();

  const rebasing = reactive(new Map<string, Set<string>>());
  const EMPTY_ROOTS: ReadonlySet<string> = new Set();

  // §0.16/§2.5: `pendingArchive` keyed `repo:item` (bookkeeping only — no queue status reads it,
  // design names none); `actionError` keyed by repo, a *background* failure surfacing after the
  // dialog that started it already closed (§0.17) — `AdeRepoView` renders it as a dismissible
  // Alert under the `main` line.
  const pendingArchive = reactive(new Map<string, string>());
  const actionError = reactive(new Map<string, string>());
  /** §0.16: `useQueue`'s own `pushing` input — branches with a `ForcePush` call in flight. */
  const pushing = reactive(new Map<string, Set<string>>());

  function pendingKey(repo: string, item: string): string {
    return `${repo}:${item}`;
  }

  function pushingFor(repo: string): ReadonlySet<string> {
    return pushing.get(repo) ?? EMPTY_ROOTS;
  }

  function addPushing(repo: string, branches: readonly string[]): void {
    let set = pushing.get(repo);
    if (!set) {
      set = new Set();
      pushing.set(repo, set);
    }
    for (const b of branches) set.add(b);
  }

  function removePushing(repo: string, branches: readonly string[]): void {
    const set = pushing.get(repo);
    if (!set) return;
    for (const b of branches) set.delete(b);
  }

  function dismissError(repo: string): void {
    actionError.delete(repo);
  }

  /** `useQueue`'s own `rebasing` input (Part 3 §0.8) — one repo's slice of the in-flight set. */
  function rebasingFor(repo: string): ReadonlySet<string> {
    return rebasing.get(repo) ?? EMPTY_ROOTS;
  }

  function addRebasing(repo: string, root: string): void {
    let set = rebasing.get(repo);
    if (!set) {
      set = new Set();
      rebasing.set(repo, set);
    }
    set.add(root);
  }

  function removeRebasing(repo: string, root: string): void {
    rebasing.get(repo)?.delete(root);
  }

  // §0.15: `adeTurns.onLive` needs every currently-live terminal id — fed from the agent store's
  // own `sessions` (terminal-level), the same source a running-session `Send` and a fresh launch
  // both resolve their own terminal id against.
  watch(
    () => agentSessionsStore.sessions.map((s) => s.terminalId),
    (ids) => adeTurns.onLive(ids),
    { immediate: true },
  );

  // §2.4: `adeUi.dialog` only ever holds one repo's dialog at a time, so one bound mutation
  // instance per kind is enough — `currentRepoId` retargets it right before each action call, and
  // `useMutation`'s own getter-based options (`MaybeRefOrGetter`) pick up the new key/fn at that
  // point (Part 3's `useAdeRefresh` precedent for the same pattern).
  const currentRepoId = ref('');
  const sendMutation = useAdeSend(currentRepoId);
  const launchMutation = useAdeLaunch(currentRepoId);
  const setQueuedAfterMutation = useAdeSetQueuedAfter(currentRepoId);
  const updateNewWorkMutation = useAdeUpdateNewWork(currentRepoId);
  const archiveMutation = useAdeArchive(currentRepoId);
  const setPlanMutation = useAdeSetPlan(currentRepoId);
  const forcePushMutation = useAdeForcePush(currentRepoId);
  const addNewWorkMutation = useAdeAddNewWork(currentRepoId);
  const addBranchMutation = useAdeAddBranch(currentRepoId);
  const addDependencyMutation = useAdeAddDependency(currentRepoId);

  function buildLaunchDeps(): LaunchDeps {
    return {
      adeSend: (args) => sendMutation.mutateAsync(args),
      adePrepareLaunch: (args) => launchMutation.mutateAsync(args),
      openTerminalSession: async (tabId, codeRepoId, cwd, cols, rows, command, launchKind) => {
        adeTerminalsStore.track(tabId);
        await terminalsStore.openTerminalSession(
          tabId,
          codeRepoId,
          cwd,
          cols,
          rows,
          command,
          launchKind,
        );
      },
      terminalSession: (tabId) => terminalsStore.terminalSession(tabId),
    };
  }

  /** One `SendDialogDeps` builder for every `dialogFlow.ts` entry point (`sendDialog`,
   *  `requestArchive`, `justDelete`) — `currentRepoId` retargets the shared mutations first, same
   *  as the pre-archive `sendDialog` did inline. */
  function buildDeps(repoId: string, ctx: DialogCtx): SendDialogDeps {
    currentRepoId.value = repoId;
    return {
      ctx,
      launch: buildLaunchDeps(),
      turns: { watch: adeTurns.watch },
      setQueuedAfter: (args) => setQueuedAfterMutation.mutateAsync(args),
      updateNewWork: (args) => updateNewWorkMutation.mutateAsync(args),
      rebasing: {
        add: (root) => addRebasing(repoId, root),
        remove: (root) => removeRebasing(repoId, root),
      },
      dropRoots: (sent) => adeUiStore.dropRoots(sent),
      setError: (message) => adeUiStore.setError(message),
      closeDialog: () => adeUiStore.closeDialog(),
      archive: (args) =>
        archiveMutation.mutateAsync({ codeRepoId: repoId, item: args.item, discard: args.discard }),
      fetchArchiveRisk: async (item) => {
        const risk = await fetchArchiveRisk(queryClient, repoId, item);
        return {
          dirty: risk.dirty.map((d) => d.path),
          unmerged: risk.unmerged,
          worktree: risk.worktree,
          blocked: risk.blocked,
        };
      },
      openDialog: (spec) => adeUiStore.openDialog(spec),
      setPendingArchive: (item, terminalId) =>
        pendingArchive.set(pendingKey(repoId, item), terminalId),
      clearPendingArchive: (item) => pendingArchive.delete(pendingKey(repoId, item)),
      setActionError: (message) => actionError.set(repoId, message),
    };
  }

  /** The dialog's own Send button (`AdeClaudeDialog.vue`), given the repo it opened for and the
   *  `DialogCtx` the repo view's own `useDialogContext` built. Reads `adeUi.dialog` for the spec
   *  and scratch state — the same object the dialog's own view rendered from. */
  async function sendDialog(repoId: string, ctx: DialogCtx): Promise<void> {
    const dialog = adeUiStore.dialog;
    if (!dialog) return;
    await runSendDialog(buildDeps(repoId, ctx), dialog.spec, {
      msg: dialog.msg,
      push: dialog.push,
      override: dialog.override,
      branchName: dialog.branchName,
    });
  }

  /** §0.16's own initial "Archive" click — before any dialog. */
  async function requestArchive(repoId: string, item: string, ctx: DialogCtx): Promise<void> {
    await runRequestArchive(buildDeps(repoId, ctx), item);
  }

  /** §0.16 "Just delete" footer button. */
  async function justDelete(repoId: string, item: string, ctx: DialogCtx): Promise<void> {
    await runJustDeleteArchive(buildDeps(repoId, ctx), item);
  }

  /** §0.13/§2.5: every plan write this phase makes (drops, the Move dialog's own `applyPlan`,
   *  overdue/overflow "Move to…", the day-off confirm's `shiftWork`) — one call, `SetPlan` is
   *  idempotent so a retry after a partial failure is always safe. */
  async function applyPlan(repoId: string, args: SetPlanArgs): Promise<void> {
    currentRepoId.value = repoId;
    await setPlanMutation.mutateAsync({ codeRepoId: repoId, days: args.days, order: args.order });
  }

  /** §0.16: the action column's own `forcePush` segment action, and a protected-branch confirm's
   *  own "yes" (re-called with `confirmProtected: [branch]`, one branch at a time). */
  async function forcePush(
    repoId: string,
    branches: readonly string[],
    confirmProtected?: readonly string[],
  ): Promise<void> {
    currentRepoId.value = repoId;
    addPushing(repoId, branches);
    try {
      const results = await forcePushMutation.mutateAsync({
        codeRepoId: repoId,
        branches: [...branches],
        confirmProtected: confirmProtected ? [...confirmProtected] : undefined,
      });
      for (const r of results) {
        if (r.ok) continue;
        if (r.error?.kind === 'ProtectedBranch') {
          adeUiStore.openConfirm({
            title: `Force push ${r.branch}`,
            text: r.error.message,
            yesLabel: 'Force push',
            noLabel: 'Cancel',
            token: r.branch,
            run: () => forcePush(repoId, [r.branch], [r.branch]),
          });
        } else {
          actionError.set(
            repoId,
            `Force push ${r.branch} failed: ${r.error?.message ?? 'unknown error'}`,
          );
        }
      }
    } finally {
      removePushing(repoId, branches);
    }
  }

  /** §0.19: the Add popover's own New-work tab — returns the new item's id so the caller can select
   *  it and close the popover. */
  async function addNewWork(
    repoId: string,
    args: Omit<AdeAddNewWorkArgs, 'codeRepoId'>,
  ): Promise<string> {
    currentRepoId.value = repoId;
    return addNewWorkMutation.mutateAsync({ codeRepoId: repoId, ...args });
  }

  /** §0.19: the Add popover's own Existing-branch tab — `kind` always `''`, Go resolves mine/review
   *  by author-email match (§0.19's own "no kind picker in this popover"). */
  async function addBranch(repoId: string, branch: string): Promise<string> {
    currentRepoId.value = repoId;
    return addBranchMutation.mutateAsync({ codeRepoId: repoId, branch, kind: '' });
  }

  /** P135 §4.8: the Add popover's own Dependency tab — same "return the id" shape as `addNewWork`/
   *  `addBranch`, the popover selects it and closes. */
  async function addDependency(
    repoId: string,
    args: Omit<AdeAddDependencyArgs, 'codeRepoId'>,
  ): Promise<string> {
    currentRepoId.value = repoId;
    return addDependencyMutation.mutateAsync({ codeRepoId: repoId, ...args });
  }

  return {
    rebasingFor,
    sendDialog,
    requestArchive,
    justDelete,
    applyPlan,
    pushingFor,
    forcePush,
    addNewWork,
    addBranch,
    addDependency,
    actionError,
    dismissError,
  };
});
