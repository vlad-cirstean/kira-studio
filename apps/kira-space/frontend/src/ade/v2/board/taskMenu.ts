import type { ShortcutId } from '@shared/domain/shortcuts';
import type { TextPart } from '@theme/varText';
import type { CardModel } from '../plan/usePlanModel';
import type { Plan, Session } from '../wire';
import { type Calendar, LATER, nextWork } from './calendar';
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
  | { kind: 'plan'; day: number }
  | { kind: 'park'; parked: boolean }
  | { kind: 'link'; url: string }
  | { kind: 'copy'; text: string }
  | { kind: 'review'; branchId: string }
  | { kind: 'archive' };

export interface TaskMenuItem {
  id: string;
  label: string;
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
}

const DONE = 'done';
const LIVE_HINT = 'Stop its running agents first';

function copyItems(c: CardModel, sessions: readonly Session[]): TaskMenuItem[] {
  const items: TaskMenuItem[] = [];
  if (c.title)
    items.push({ id: 'ade-task-copy-title', label: 'Title', cmd: { kind: 'copy', text: c.title } });
  items.push({ id: 'ade-task-copy-id', label: 'Task id', cmd: { kind: 'copy', text: c.task.id } });
  if (c.task.jira) {
    items.push({
      id: 'ade-task-copy-jira',
      label: 'Jira link',
      cmd: { kind: 'copy', text: c.task.jira.url },
    });
  }
  const names = c.rows
    .filter((r) => r.branch.kind === 'mine' && r.branch.name)
    .map((r) => r.branch.name);
  if (names.length) {
    items.push({
      id: 'ade-task-copy-branches',
      label: 'Branch names',
      cmd: { kind: 'copy', text: names.join('\n') },
    });
  }
  const latest = sessions
    .filter((s) => s.claudeSessionId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (latest) {
    items.push({
      id: 'ade-task-copy-session',
      label: 'Latest Claude session id',
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
      hint: live ? LIVE_HINT : undefined,
    })),
    {
      id: 'ade-task-stage-done',
      label: 'Done',
      cmd: { kind: 'moveStage', stageId: DONE },
      checked: current === DONE,
      disabled: live,
      hint: live ? LIVE_HINT : undefined,
    },
  ];
  const out: TaskMenuEntry[] = [
    { type: 'submenu', id: 'ade-task-stage', label: 'Move to stage', items },
  ];
  const at = c.blocks.find((b) => b.stage.id === current);
  if (at) {
    out.push({
      type: 'item',
      id: 'ade-task-skip',
      label: `Skip ${at.stage.name}`,
      cmd: { kind: 'moveStage', stageId: nextStageId(c.blocks, current) },
      disabled: live,
      hint: live ? LIVE_HINT : undefined,
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
        ...item(choices[0], 'ade-task-review', 'Review code'),
        shortcut: 'ade.reviewCode',
      },
    ];
  }
  return [
    {
      type: 'submenu',
      id: 'ade-task-review',
      label: 'Review code',
      items: choices.map((c) => item(c, `ade-task-review-${c.branchId}`, c.label)),
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
    label: 'Plan',
    items: [
      at('ade-task-plan-today', 'Move to today', 0),
      at('ade-task-plan-next', 'Move to next work day', nextWork(i.cal, 0)),
      at('ade-task-plan-later', 'Move to Later', LATER),
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
        label: 'Stop running agents',
        cmd: { kind: 'stopRuns' },
      });
    }
    out.push({ type: 'separator' });
  }

  if (running.length) {
    out.push({
      type: 'submenu',
      id: 'ade-task-open-session',
      label: 'Open session',
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
    label: 'Show sessions',
    cmd: { kind: 'showSessions' },
  });

  if (!review) {
    out.push(planEntry(i));
    out.push({
      type: 'item',
      id: 'ade-task-park',
      label: c.parked ? 'Mark as merging' : 'Mark as not merging',
      cmd: { kind: 'park', parked: !c.parked },
    });
  }

  const links: TaskMenuItem[] = [];
  if (c.task.jira) {
    links.push({
      id: 'ade-task-jira',
      label: 'Open Jira issue',
      cmd: { kind: 'link', url: c.task.jira.url },
    });
  }
  if (c.task.githubUrl) {
    links.push({
      id: 'ade-task-github',
      label: 'Open on GitHub',
      cmd: { kind: 'link', url: c.task.githubUrl },
    });
  }
  if (links.length)
    out.push({ type: 'separator' }, ...links.map((l) => ({ type: 'item' as const, ...l })));

  const copy = copyItems(c, i.sessions);
  out.push({ type: 'submenu', id: 'ade-task-copy', label: 'Copy', items: copy });
  out.push(
    { type: 'separator' },
    {
      type: 'item',
      id: 'ade-task-archive',
      label: 'Archive…',
      cmd: { kind: 'archive' },
      danger: true,
      disabled: i.archivePending,
    },
  );
  return out;
}
