import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import { useTerminalsStore } from '../../state/terminals';
import type { DialogCtx } from '../dialogCompose';
import { sendDialog as runSendDialog } from '../dialogFlow';
import type { LaunchDeps } from '../launch';
import { useAdeLaunch, useAdeSend, useAdeSetQueuedAfter, useAdeUpdateNewWork } from '../mutations';
import { adeTurns } from '../turnWatch';
import { useAdeUiStore } from './adeUi';
import { useAgentSessionsStore } from './agentSessions';

// P129 Part 4 §2.1/§2.5: in-flight agent actions — a separate concern from `adeUi`'s own dialog
// state (CLAUDE.md's own Pinia rule: one store, one concern). Archive's own fields
// (`pendingArchive`, `actionError`) and actions (`requestArchive`, `justDelete`) land in this
// file's own §0.16 commit.
export const useAdeActionsStore = defineStore('adeActions', () => {
  const adeUiStore = useAdeUiStore();
  const agentSessionsStore = useAgentSessionsStore();
  const terminalsStore = useTerminalsStore();

  const rebasing = reactive(new Map<string, Set<string>>());
  const EMPTY_ROOTS: ReadonlySet<string> = new Set();

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

  function buildLaunchDeps(): LaunchDeps {
    return {
      adeSend: (args) => sendMutation.mutateAsync(args),
      adePrepareLaunch: (args) => launchMutation.mutateAsync(args),
      openTerminalSession: (tabId, codeRepoId, cwd, cols, rows, command, launchKind) =>
        terminalsStore.openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command, launchKind),
      terminalSession: (tabId) => terminalsStore.terminalSession(tabId),
    };
  }

  /** The dialog's own Send button (`AdeClaudeDialog.vue`), given the repo it opened for and the
   *  `DialogCtx` the repo view's own `useDialogContext` built. Reads `adeUi.dialog` for the spec
   *  and scratch state — the same object the dialog's own view rendered from. */
  async function sendDialog(repoId: string, ctx: DialogCtx): Promise<void> {
    const dialog = adeUiStore.dialog;
    if (!dialog) return;
    currentRepoId.value = repoId;
    await runSendDialog(
      {
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
      },
      dialog.spec,
      {
        msg: dialog.msg,
        push: dialog.push,
        override: dialog.override,
        branchName: dialog.branchName,
      },
    );
  }

  return { rebasingFor, sendDialog };
});
