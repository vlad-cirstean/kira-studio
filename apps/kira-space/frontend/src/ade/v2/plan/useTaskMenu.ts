import { useClipboard } from '@vueuse/core';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { control } from '../../../bridge/control';
import { movePlanArgs } from '../board/dropPlan';
import { taskPatch } from '../board/panelFacts';
import {
  type TaskMenuCmd,
  type TaskMenuEntry,
  type TaskMenuItem,
  taskMenuModel,
} from '../board/taskMenu';
import { useSetPlan, useSetTaskStage, useStopRun, useUpdateTask } from '../queries';
import { useTaskAction } from '../run/useTaskAction';
import { useSessionViews } from '../sessions/useSessionViews';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { type CardModel, usePlanModel } from './usePlanModel';

/** Opens the task context menu for `card`: on a right-click, or under an anchor element. */
export function useTaskMenu(card: MaybeRefOrGetter<CardModel>) {
  const ui = useAdeBoardUiStore();
  const dialogs = useAdeDialogsStore();
  const contextMenu = useContextMenuStore();
  const { model, today, sessions } = usePlanModel();
  const { view } = useSessionViews();
  const { perform } = useTaskAction(card);
  const setStage = useSetTaskStage();
  const setPlan = useSetPlan();
  const stopRun = useStopRun();
  const update = useUpdateTask();
  const { copy } = useClipboard();

  function fail(taskId: string, err: unknown): void {
    ui.select(taskId);
    ui.actionError[taskId] = err instanceof Error ? err.message : String(err);
  }

  async function run(cmd: TaskMenuCmd): Promise<void> {
    const c = toValue(card);
    const taskId = c.task.id;
    delete ui.actionError[taskId];
    try {
      switch (cmd.kind) {
        case 'action':
          return await perform();
        case 'moveStage':
          await setStage.mutateAsync({ taskId, stageId: cmd.stageId });
          return;
        case 'stopRuns':
          await Promise.all(
            c.task.runs
              .filter((r) => r.state === 'running' || r.state === 'pending')
              .map((r) => stopRun.mutateAsync({ runId: r.id })),
          );
          return;
        case 'openSession':
          return ui.openSession({
            taskId,
            branchId: cmd.session.branchId,
            sessionId: cmd.session.id,
          });
        case 'showSessions':
          ui.select(taskId);
          ui.taskTab = 'sessions';
          return;
        case 'plan': {
          const m = model.value;
          if (m)
            await setPlan.mutateAsync(
              movePlanArgs(m.board.plan, today.value, taskId, null, cmd.day),
            );
          return;
        }
        case 'park':
          await update.mutateAsync({
            taskId,
            patch: taskPatch({ kind: cmd.parked ? 'parked' : 'task' }),
          });
          return;
        case 'link':
          return await control.linkOpenExternal(cmd.url);
        case 'copy':
          return await copy(cmd.text);
        case 'archive':
          return dialogs.archive(taskId);
      }
    } catch (err) {
      fail(taskId, err);
    }
  }

  function toItem(e: TaskMenuItem): MenuItem {
    return {
      type: 'item',
      id: e.id,
      label: e.label,
      disabled: e.disabled,
      hint: e.hint,
      checked: e.checked,
      danger: e.danger,
      run: () => run(e.cmd),
    };
  }
  function toMenu(e: TaskMenuEntry): MenuItem {
    if (e.type === 'item') return toItem(e);
    if (e.type === 'submenu')
      return { type: 'submenu', id: e.id, label: e.label, items: e.items.map(toItem) };
    return e;
  }

  function items(): MenuItem[] | null {
    const m = model.value;
    const c = toValue(card);
    if (!m) return null;
    return taskMenuModel({
      card: c,
      sessions: sessions.value.filter((s) => s.taskId === c.task.id),
      sessionLabel: (s) => view(s).tabName,
      plan: m.board.plan,
      cal: m.cal,
      archivePending: dialogs.pending.has(`archive:${c.task.id}`),
    }).map(toMenu);
  }

  function open(ev: MouseEvent): void {
    const list = items();
    if (!list) return;
    ev.preventDefault();
    ev.stopPropagation();
    ui.select(toValue(card).task.id);
    contextMenu.openContextMenu(ev, list);
  }

  /** Under `el`, for the keyboard and the panel's More button. */
  function openAt(el: Element): void {
    const list = items();
    if (!list) return;
    ui.select(toValue(card).task.id);
    const r = el.getBoundingClientRect();
    contextMenu.openContextMenuAt(r.left, r.bottom, list);
  }

  return { open, openAt };
}
