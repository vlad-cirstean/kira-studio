import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { useTerminalsStore } from '../../../state/terminals';
import type { BranchAction } from '../board/actions';
import {
  type DialogSpec,
  mergeSpec,
  rebaseSpec,
  specForBranchAction,
  stageSpec,
  startSpec,
} from '../dialog/compose';
import { deleteAnyway, type FlowDeps, requestArchive, sendDialog } from '../dialog/flow';
import { adeTurns } from '../dialog/turnWatch';
import { useDialogCtx } from '../dialog/useDialogCtx';
import {
  useArchiveRisk,
  useArchiveTask,
  useLaunchStage,
  useRecordMerge,
  useSend,
  useSetQueuedAfter,
  useStartBranch,
} from '../queries';
import { useAdeBoardUiStore } from './adeBoardUi';
import { useAdeTerminalsStore } from './adeTerminals';
import { useSetupWait } from './useSetupWait';

// The Claude dialog: which one is open, its edits and the work in flight behind it. One concern:
// the dialog flow. Every opener (action cell, branch header, fix menu, Details, Needs you) goes
// through here, so the delivery rules live once.
export const useAdeDialogsStore = defineStore('adeDialogs', () => {
  const ui = useAdeBoardUiStore();
  const ctx = useDialogCtx();
  const terminals = useTerminalsStore();
  const adeTerminals = useAdeTerminalsStore();

  const spec = ref<DialogSpec | null>(null);
  /** `null` = the unedited template. */
  const msg = ref<string | null>(null);
  const push = ref(false);
  const override = ref(false);
  const error = ref('');
  /** In-flight work: `rebase:<branch>`, `merge:<branch>:<target>`, `archive:<task>`. */
  const pending = reactive(new Set<string>());

  const sendM = useSend();
  const startM = useStartBranch();
  const stageM = useLaunchStage();
  const queuedM = useSetQueuedAfter();
  const mergeM = useRecordMerge();
  const riskM = useArchiveRisk();
  const archiveM = useArchiveTask();

  // A launch refused behind a running prepare script retries by itself until the worktree is ready.
  const setupWait = useSetupWait(() => send());
  const waitingSetup = setupWait.waiting;

  function open(next: DialogSpec): void {
    setupWait.stop();
    spec.value = next;
    msg.value = null;
    push.value = false;
    override.value = false;
    error.value = '';
  }

  function close(): void {
    setupWait.stop();
    spec.value = null;
  }

  function deps(): FlowDeps | null {
    const c = ctx.value;
    if (!c) return null;
    return {
      ctx: c,
      launch: {
        send: (a) => sendM.mutateAsync(a),
        startBranch: (a) => startM.mutateAsync(a),
        launchStage: (a) => stageM.mutateAsync(a),
        openTerminalSession: async (tabId, codeRepoId, cwd, cols, rows, command, kind) => {
          adeTerminals.track(tabId);
          await terminals.openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command, kind);
        },
        terminalSession: (id) => terminals.terminalSession(id),
      },
      turns: { watch: adeTurns.watch },
      setQueuedAfter: (a) => queuedM.mutateAsync(a),
      recordMerge: (a) => mergeM.mutateAsync(a),
      archiveTask: (a) => archiveM.mutateAsync(a),
      archiveRisk: (a) => riskM.mutateAsync(a),
      pending: { add: (k) => pending.add(k), remove: (k) => pending.delete(k) },
      setError: (m) => {
        setupWait.stop();
        error.value = m;
      },
      waitForSetup: () => {
        error.value = '';
        setupWait.start();
      },
      setActionError: (taskId, m) => {
        ui.actionError[taskId] = m;
      },
      closeDialog: close,
      openDialog: open,
      opened: (e) => ui.openSession(e),
    };
  }

  async function send(): Promise<void> {
    const d = deps();
    if (d && spec.value) {
      error.value = '';
      await sendDialog(d, spec.value, {
        msg: msg.value,
        push: push.value,
        override: override.value,
      });
    }
  }

  async function discardAnyway(): Promise<void> {
    const d = deps();
    if (d && spec.value) await deleteAnyway(d, spec.value);
  }

  async function archive(taskId: string): Promise<void> {
    const d = deps();
    if (!d) return;
    delete ui.actionError[taskId];
    await requestArchive(d, taskId);
  }

  function rebase(branchId: string, action: BranchAction): void {
    const c = ctx.value;
    const next = c ? specForBranchAction(c, branchId, action) : null;
    if (next) open(next);
  }

  /** Rebase `rootId` and its stack onto another branch or the repo's main (header, fix menu). */
  function rebaseOnto(rootId: string, onto: string, title: string): void {
    const c = ctx.value;
    if (c) open(rebaseSpec(c, rootId, onto, title));
  }

  function merge(branchId: string, target: string): void {
    const c = ctx.value;
    if (c) open(mergeSpec(c, branchId, target));
  }

  function stage(taskId: string): void {
    const c = ctx.value;
    if (c) open(stageSpec(c, taskId));
  }

  function start(branchId: string): void {
    open(startSpec(branchId));
  }

  function pick(branchId: string, choice: string): void {
    const s = spec.value;
    if (!s) return;
    spec.value = {
      ...s,
      targets: s.targets.map((t) => (t.branchId === branchId ? { ...t, choice } : t)),
    };
  }

  return {
    spec,
    msg,
    push,
    override,
    error,
    waitingSetup,
    pending,
    ctx,
    close,
    send,
    discardAnyway,
    archive,
    rebase,
    rebaseOnto,
    merge,
    stage,
    start,
    pick,
  };
});
