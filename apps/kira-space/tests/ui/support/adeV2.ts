import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { KiraApp, RelaunchOptions } from '../fixtures';
import { IPC } from './ipcChannels';
import { emitWailsEvent } from './mockRuntime';
import type { ControlSnapshot } from './types';

// The ade v2 fixtures are the P143 captures; `FIXED_NOW` is the day they are anchored to
// (Tue 2026-09-22), so band labels and relative times match the committed data.
export const FIXED_NOW = 1_790_070_000_000;

const FIXTURE_DIR = resolve(__dirname, '../../fixtures/ade-v2');

export function adeFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;
}

function repoRecord(id: string, name: string, order: number) {
  return {
    id,
    name,
    root: `/tmp/${name}`,
    repoId: `/tmp/${name}`,
    sortOrder: order,
    color: 'none',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const REPO_RECORDS = [
  repoRecord('repo-web-app', 'acme-customer-dashboard-web-frontend', 1),
  repoRecord('repo-api', 'acme-platform-core-api-service', 2),
  repoRecord('repo-mobile', 'acme-mobile-react-native-app', 3),
];

function firstWorkflow(): unknown {
  return adeFixture<{ workflows: unknown[] }>('workflows').workflows[0];
}

/** The committed board with `edit` applied to a copy, for a spec that needs another task state. */
export function adeBoard(edit: (board: AdeBoardFx) => void): AdeBoardFx {
  const board = adeFixture<AdeBoardFx>('board');
  edit(board);
  return board;
}

/** Fields of `board.json` the specs edit; the rest passes through untyped. */
export interface AdeBoardFx {
  tasks: ({
    id: string;
    stageId: string;
    workflowId: string;
    runs: Record<string, unknown>[];
  } & Record<string, unknown>)[];
  branches: ({ id: string; setup: Record<string, unknown> | null } & Record<string, unknown>)[];
  [key: string]: unknown;
}

/** Boots straight into the ade mode with the committed board, PR, workflow and repo fixtures;
 *  `extra` snapshots replace a default of the same channel. */
export function adeV2Control(extra: readonly ControlSnapshot[] = []): ControlSnapshot[] {
  const defaults: ControlSnapshot[] = [
    { channel: IPC.windowsEnsure, response: { mode: 'ade' } },
    { channel: IPC.codeWorkspaceListRepos, response: REPO_RECORDS },
    { channel: IPC.adeTaskBoard, response: adeFixture('board') },
    { channel: IPC.adeTaskPrs, response: adeFixture('prs') },
    { channel: IPC.adeTaskWorkflows, response: adeFixture('workflows') },
    { channel: IPC.adeTaskRepos, response: adeFixture('repos') },
    { channel: IPC.adeTaskBacklog, response: adeFixture('backlog') },
    { channel: IPC.adeTaskSetPlan },
    { channel: IPC.adeTaskUpdateTask, response: adeFixture('task') },
    { channel: IPC.adeTaskAddTaskRepo, response: adeFixture('branch') },
    {
      channel: IPC.adeTaskUpdateBacklogItem,
      response: adeFixture<{ items: unknown[] }>('backlog').items[0],
    },
    { channel: IPC.adeTaskMoveBacklogItem },
    { channel: IPC.adeTaskDeleteBacklogItem },
    { channel: IPC.adeTaskPromoteBacklogItem, response: adeFixture('task') },
    { channel: IPC.adeTaskWorkflowYaml, response: adeFixture('workflow-yaml') },
    { channel: IPC.adeTaskValidateWorkflowYaml, response: adeFixture('workflow-validation') },
    { channel: IPC.adeTaskSaveWorkflow, response: firstWorkflow() },
    { channel: IPC.adeTaskSaveWorkflowYaml, response: firstWorkflow() },
    { channel: IPC.adeTaskImportWorkflow, response: firstWorkflow() },
    { channel: IPC.adeTaskNewWorkflow, response: firstWorkflow() },
    {
      channel: IPC.adeTaskUpdateRepo,
      response: adeFixture<{ repos: unknown[] }>('repos').repos[0],
    },
    { channel: IPC.adeTaskAddFolder, response: adeFixture('folder-import') },
    {
      channel: IPC.adeTaskSetFolderWatch,
      response: adeFixture<{ folders: unknown[] }>('repos').folders[0],
    },
    { channel: IPC.adeTaskRemoveFolder },
    { channel: IPC.codeWorkspaceImportRepo, response: REPO_RECORDS[0] },
    { channel: IPC.adeTaskStartRun, response: adeFixture('start-run') },
    { channel: IPC.adeTaskSetTaskWorkflow, response: adeFixture('task') },
    { channel: IPC.adeTaskApprove },
    { channel: IPC.adeTaskRetryRun },
    { channel: IPC.adeTaskStageDone, response: adeFixture('task') },
    { channel: IPC.adeTaskSetTaskStage, response: adeFixture('task') },
    { channel: IPC.adeTaskRetrySetup },
    { channel: IPC.adeTaskReadLog, response: adeFixture('log-page') },
    { channel: IPC.adeTaskSessions, response: adeFixture('sessions') },
    { channel: IPC.adeTaskStopRun },
    { channel: IPC.adeTaskTakeOver, response: adeFixture('launch') },
    { channel: IPC.adeTaskLaunchStage, response: adeFixture('launch') },
    { channel: IPC.adeTaskStartBranch, response: adeFixture('launch') },
    { channel: IPC.adeTaskSend },
    { channel: IPC.adeTaskFocusSession, response: true },
    { channel: IPC.adeTaskArchiveRisk, response: adeFixture('archive-risk') },
    { channel: IPC.adeTaskArchiveTask },
    { channel: IPC.adeTaskRecordMerge },
    { channel: IPC.adeTaskSetQueuedAfter },
    { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
  ];
  const overridden = new Set(extra.map((s) => s.channel));
  return [...defaults.filter((s) => !overridden.has(s.channel)), ...extra];
}

/** Opens the ade Plan on the fixture day; the clock is pinned before the first navigation. */
export async function openPlan(
  relaunch: (options?: RelaunchOptions) => Promise<KiraApp>,
  extra: readonly ControlSnapshot[] = [],
): Promise<KiraApp> {
  const app = await relaunch({ control: adeV2Control(extra), clockTime: FIXED_NOW });
  await app.window.locator('[data-testid="ade-plan"]').waitFor();
  return app;
}

export function bandOf(page: Page, day: number) {
  return page.locator(`[data-testid="ade-day-band"][data-ade-day="${day}"]`);
}

/** Pushes `runs` as an `ade:task:runs` event. */
export async function emitRuns(page: Page, runs: Record<string, unknown>[]): Promise<void> {
  await emitWailsEvent(page, IPC.adeTaskRunsChanged, { runs });
}

/** Pushes log `chunks` of one run or setup. */
export async function emitLog(
  page: Page,
  kind: 'run' | 'setup',
  id: string,
  chunks: { seq: number; at: number; stream: string; text: string }[],
): Promise<void> {
  await emitWailsEvent(page, IPC.adeTaskLogChanged, { kind, id, chunks });
}

/** Pushes an `ade:task:sessions` event; the renderer refetches the (static) sessions snapshot. */
export async function emitSessions(page: Page): Promise<void> {
  await emitWailsEvent(page, IPC.adeTaskSessionsChanged, null);
}

/** Pushes an `ade:task:open-session` event (the backend asking the window to show a session). */
export async function emitOpenSession(
  page: Page,
  event: { taskId: string; branchId: string; sessionId: string },
): Promise<void> {
  await emitWailsEvent(page, IPC.adeTaskOpenSession, event);
}

/** Pushes one Claude Code hook event for a terminal (`UserPromptSubmit`, `Stop`, `SessionEnd`, ...). */
export async function emitAgentEvent(page: Page, terminalId: string, event: string): Promise<void> {
  await emitWailsEvent(page, IPC.agentEvent, {
    terminalId,
    event,
    sessionId: '',
    cwd: '',
    toolName: '',
    toolUseId: '',
    notificationType: '',
    message: '',
    source: '',
    reason: '',
  });
}

/** Pushes the live agent-session list (one entry per Claude Code terminal). */
export async function emitAgentSessions(page: Page, terminalIds: readonly string[]): Promise<void> {
  await emitWailsEvent(page, IPC.agentSessions, {
    sessions: terminalIds.map((terminalId) => ({ terminalId, cwd: '' })),
  });
}
