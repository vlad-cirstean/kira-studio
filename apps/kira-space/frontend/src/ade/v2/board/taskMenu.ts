import type { ShortcutId } from '@shared/domain/shortcuts';
import { t } from '@theme/i18n';
import type { TextPart } from '@theme/varText';
import type { CardModel } from '../plan/usePlanModel';
import type { Plan, Session } from '../wire';
import { type Calendar, LATER, nextWork } from './calendar';
import type { ChangeBaseChoice } from './changeBase';
import type { RebaseAct } from './rebaseActions';
import type { ReviewChoice } from './reviewCode';
import { nextStageId } from './stageBlocks';

// Task context menu (P198): which entries a task shows and what each does. Pure; `useTaskMenu` maps
// a command to its call.

export type TaskMenuCmd =
  | { kind: 'action' }
  | { kind: 'moveStage'; stageId: string }
  | { kind: 'stopRuns' }
  | { kind: 'openSession'; session: Session }
  | { kind: 'showSessions' }
  | { kind: 'automation'; scriptId: string }
  | { kind: 'plan'; day: number }
  | { kind: 'park'; parked: boolean }
  | { kind: 'link'; url: string }
  | { kind: 'copy'; text: string }
  | { kind: 'review'; branchId: string }
  | { kind: 'changeBase'; act: RebaseAct }
  | { kind: 'archive' };

export interface TaskMenuItem {
  id: string;
  label: string;
  icon?: string;
  cmd: TaskMenuCmd;
  disabled?: boolean;
  hint?: string | readonly TextPart[];
  shortcut?: ShortcutId;
  checked?: boolean;
  danger?: boolean;
}

export type TaskMenuEntry =
  | { type: 'label'; label: string }
  | { type: 'separator' }
  | ({ type: 'item' } & TaskMenuItem)
  | { type: 'submenu'; id: string; label: string; items: TaskMenuItem[] };

export interface TaskMenuInput {
  card: CardModel;
  /** The task's sessions. */
  sessions: readonly Session[];
  /** Menu text of a running session. */
  sessionLabel: (s: Session) => string;
  plan: Plan;
  cal: Calendar;
  archivePending: boolean;
  /** The task's Review code targets; none for a parked task. */
  choices: readonly ReviewChoice[];
  /** The task's Change base targets. */
  baseChoices: readonly ChangeBaseChoice[];
  /** The Run automation submenu items. */
  automations: readonly TaskMenuItem[];
}

const DONE = 'done';
const liveHint = (): string => t('space.ade.board.taskMenu.liveBlocked.tooltip');

function copyItems(c: CardModel, sessions: readonly Session[]): TaskMenuItem[] {
  const items: TaskMenuItem[] = [];
  if (c.title)
    items.push({
      id: 'ade-task-copy-title',
      label: t('common.field.title.label'),
      cmd: { kind: 'copy', text: c.title },
    });
  items.push({
    id: 'ade-task-copy-id',
    label: t('space.ade.board.taskMenu.taskId.label'),
    cmd: { kind: 'copy', text: c.task.id },
  });
  if (c.task.jira) {
    items.push({
      id: 'ade-task-copy-jira',
      label: t('space.ade.board.taskMenu.jiraLink.label'),
      cmd: { kind: 'copy', text: c.task.jira.url },
    });
  }
  const names = c.rows
    .filter((r) => r.branch.kind === 'mine' && r.branch.name)
    .map((r) => r.branch.name);
  if (names.length) {
    items.push({
      id: 'ade-task-copy-branches',
      label: t('space.ade.board.taskMenu.branchNames.label'),
      cmd: { kind: 'copy', text: names.join('\n') },
    });
  }
  const latest = sessions
    .filter((s) => s.claudeSessionId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (latest) {
    items.push({
      id: 'ade-task-copy-session',
      label: t('space.ade.board.taskMenu.latestSessionId.label'),
      cmd: { kind: 'copy', text: latest.claudeSessionId },
    });
  }
  return items;
}

function stageEntries(c: CardModel, live: boolean): TaskMenuEntry[] {
  if (!c.blocks.length) return [];
  const current = c.task.stageId;
  const items: TaskMenuItem[] = [
    ...c.blocks.map((b) => ({
      id: `ade-task-stage-${b.stage.id}`,
      label: b.stage.name,
      cmd: { kind: 'moveStage', stageId: b.stage.id } as const,
      checked: b.stage.id === current,
      disabled: live || (b.state === 'skipped' && b.stage.id !== current),
      hint: live ? liveHint() : undefined,
    })),
    {
      id: 'ade-task-stage-done',
      label: t('space.common.status.done.status'),
      cmd: { kind: 'moveStage', stageId: DONE },
      checked: current === DONE,
      disabled: live,
      hint: live ? liveHint() : undefined,
    },
  ];
  const out: TaskMenuEntry[] = [
    {
      type: 'submenu',
      id: 'ade-task-stage',
      label: t('space.ade.board.taskMenu.moveToStage.label'),
      items,
    },
  ];
  const at = c.blocks.find((b) => b.stage.id === current);
  if (at) {
    out.push({
      type: 'item',
      id: 'ade-task-skip',
      label: t('space.ade.board.taskMenu.skipStage.label', { stage: at.stage.name }),
      cmd: { kind: 'moveStage', stageId: nextStageId(c.blocks, current) },
      disabled: live,
      hint: live ? liveHint() : undefined,
    });
  }
  return out;
}

function reviewEntry(choices: readonly ReviewChoice[]): TaskMenuEntry[] {
  const item = (c: ReviewChoice, id: string, label: string): TaskMenuItem => ({
    id,
    label,
    cmd: { kind: 'review', branchId: c.branchId },
    disabled: c.disabled,
    hint: c.tip,
  });
  if (choices.length === 0) return [];
  if (choices.length === 1) {
    return [
      {
        type: 'item',
        ...item(choices[0], 'ade-task-review', t('space.ade.board.taskMenu.reviewCode.label')),
        shortcut: 'ade.reviewCode',
      },
    ];
  }
  return [
    {
      type: 'submenu',
      id: 'ade-task-review',
      label: t('space.ade.board.taskMenu.reviewCode.label'),
      items: choices.map((c) => item(c, `ade-task-review-${c.branchId}`, c.label)),
    },
  ];
}

function changeBaseEntry(choices: readonly ChangeBaseChoice[]): TaskMenuEntry[] {
  const item = (c: ChangeBaseChoice, id: string, label: string): TaskMenuItem => ({
    id,
    label,
    cmd: { kind: 'changeBase', act: c.act },
    disabled: c.disabled,
    hint: c.tip,
  });
  if (choices.length === 0) return [];
  if (choices.length === 1) {
    return [
      {
        type: 'item',
        ...item(choices[0], 'ade-task-change-base', t('space.ade.rebase.changeBase.label')),
      },
    ];
  }
  return [
    {
      type: 'submenu',
      id: 'ade-task-change-base',
      label: t('space.ade.rebase.changeBase.label'),
      items: choices.map((c) => item(c, `ade-task-change-base-${c.branchId}`, c.label)),
    },
  ];
}

function planEntry(i: TaskMenuInput): TaskMenuEntry {
  const day = i.card.entry.day;
  const at = (id: string, label: string, to: number): TaskMenuItem => ({
    id,
    label,
    cmd: { kind: 'plan', day: to },
    checked: day === to,
    disabled: day === to,
  });
  return {
    type: 'submenu',
    id: 'ade-task-plan',
    label: t('space.common.plan.label'),
    items: [
      at('ade-task-plan-today', t('space.ade.board.taskMenu.moveToday.label'), 0),
      at(
        'ade-task-plan-next',
        t('space.ade.board.taskMenu.moveNextWorkDay.label'),
        nextWork(i.cal, 0),
      ),
      at('ade-task-plan-later', t('space.ade.board.taskMenu.moveLater.label'), LATER),
    ],
  };
}

export function taskMenuModel(i: TaskMenuInput): TaskMenuEntry[] {
  const c = i.card;
  const review = c.review;
  const out: TaskMenuEntry[] = [{ type: 'label', label: c.title }, ...reviewEntry(i.choices)];
  const live = c.task.runs.some((r) => r.state === 'running');
  const running = i.sessions.filter((s) => s.state === 'running' && s.mode === 'tui');

  if (!review) {
    if (c.action && c.action.kind !== 'archive') {
      out.push({
        type: 'item',
        id: 'ade-task-action',
        label: c.action.label.replace(/^▶ /, ''),
        cmd: { kind: 'action' },
        hint: c.action.tip,
      });
    }
    out.push(...stageEntries(c, live));
    if (c.task.runs.some((r) => r.state === 'running' || r.state === 'pending')) {
      out.push({
        type: 'item',
        id: 'ade-task-stop',
        label: t('space.ade.board.taskMenu.stopRuns.label'),
        cmd: { kind: 'stopRuns' },
      });
    }
    out.push({ type: 'separator' });
  }

  if (running.length) {
    out.push({
      type: 'submenu',
      id: 'ade-task-open-session',
      label: t('space.ade.board.taskMenu.openSession.label'),
      items: running.map((s) => ({
        id: `ade-task-open-session-${s.id}`,
        label: i.sessionLabel(s),
        cmd: { kind: 'openSession', session: s },
      })),
    });
  }
  out.push({
    type: 'item',
    id: 'ade-task-sessions',
    label: t('space.ade.board.taskMenu.showSessions.label'),
    cmd: { kind: 'showSessions' },
  });
  out.push({
    type: 'submenu',
    id: 'ade-task-automation',
    label: t('space.ade.board.taskMenu.runAutomation.label'),
    items: [...i.automations],
  });

  if (!review) {
    out.push(planEntry(i));
    out.push({
      type: 'item',
      id: 'ade-task-park',
      label: t(
        c.parked
          ? 'space.ade.board.taskMenu.markMerging.label'
          : 'space.ade.board.taskMenu.markNotMerging.label',
      ),
      cmd: { kind: 'park', parked: !c.parked },
    });
    out.push(...changeBaseEntry(i.baseChoices));
  }

  const links: TaskMenuItem[] = [];
  if (c.task.jira) {
    links.push({
      id: 'ade-task-jira',
      label: t('space.ade.board.taskMenu.openJira.label'),
      cmd: { kind: 'link', url: c.task.jira.url },
    });
  }
  if (c.task.githubUrl) {
    links.push({
      id: 'ade-task-github',
      label: t('space.ade.board.taskMenu.openGithub.label'),
      cmd: { kind: 'link', url: c.task.githubUrl },
    });
  }
  if (links.length)
    out.push({ type: 'separator' }, ...links.map((l) => ({ type: 'item' as const, ...l })));

  const copy = copyItems(c, i.sessions);
  out.push({
    type: 'submenu',
    id: 'ade-task-copy',
    label: t('common.action.copy.label'),
    items: copy,
  });
  out.push(
    { type: 'separator' },
    {
      type: 'item',
      id: 'ade-task-archive',
      label: t('space.common.archive.label'),
      cmd: { kind: 'archive' },
      danger: true,
      disabled: i.archivePending,
    },
  );
  return out;
}
