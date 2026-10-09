import { expect, type Page } from '@playwright/test';
import type { KiraSpaceApp } from '../fixtures';

/** One agent step, then one that waits for approval; `fake claude` finishes each with `done`. */
export const FLOW_YAML = `id: flow
name: Flow
stages:
  - id: build
    name: Build
    kind: agent
    status: In progress
    steps:
      - id: one
        name: one
        runs_on: each repo
        timeout: 1m
        prompt: work on {branch} in {repo}
      - id: two
        name: two
        runs_on: each repo
        timeout: 1m
        before: approval
        prompt: finish {branch} in {repo}
`;

export const DONE_SCENARIO = { claude: { '*': ['done'] } };

export interface BoardTask {
  id: string;
  title: string;
  stageId: string;
  runs: { id: string; stepId: string; state: string }[];
}

export interface BoardBranch {
  id: string;
  taskId: string;
  name: string;
  worktree: string;
}

export interface Board {
  tasks: BoardTask[];
  branches: BoardBranch[];
}

export async function saveFlow(kira: KiraSpaceApp): Promise<void> {
  const entry = await kira.call<{ error: unknown }>('AdeTaskService', 'SaveWorkflowYaml', {
    fileName: 'flow.yaml',
    yaml: FLOW_YAML,
  });
  expect(entry.error).toBeNull();
}

/** Opens the Agents module on its Plan. */
export async function openPlan(kira: KiraSpaceApp): Promise<Page> {
  await kira.reload();
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="ade"]').click();
  await page.locator('[data-testid="ade-plan"]').waitFor();
  return page;
}

/** Files a task through the Add task popover; the first repo is picked by default. */
export async function addTask(page: Page, title: string): Promise<void> {
  await page.locator('[data-testid="ade-add"]').click();
  await page.locator('[data-testid="ade-nw-title"]').fill(title);
  await page.locator('[data-testid="ade-nw-add"]').click();
  await expect(page.locator('[data-testid="ade-add-popover"]')).toHaveCount(0);
}

/** Selects the flow on the open task panel and starts its run on a named branch. */
export async function runTask(page: Page, branch: string): Promise<void> {
  await page.locator('[data-testid="ade-workflow-select"]').selectOption('flow');
  await page.locator('[data-testid="ade-task-cells"] [data-testid="ade-task-action-run"]').click();
  await page.locator('[data-testid="ade-run-branch"]').fill(branch);
  await page.locator('[data-testid="ade-run-send"]').click();
}

const REBASE_SH = 'git fetch -q origin && git rebase -q origin/main';
const rebaseAction = (sh: string, finish: Record<string, unknown>) => ({
  sh,
  mcp: [{ server: 'kira-ade', tool: 'finish_step', args: finish }],
});

/** Attempt 1 is the flow step; attempt 2 and on are rebase runs. */
export const REBASE_DONE_SCENARIO = {
  claude: {
    '*': ['done', rebaseAction(REBASE_SH, { status: 'done', summary: 'rebased' })],
  },
};

/** The rebase leaves its conflict in the worktree and reports it. */
export const REBASE_CONFLICT_SCENARIO = {
  claude: {
    '*': [
      'done',
      rebaseAction(`${REBASE_SH} || true`, {
        status: 'failed',
        summary: 'conflict',
        reason: 'clash.txt conflicts',
        conflictedFiles: ['clash.txt'],
        lastGitError: 'CONFLICT (add/add): clash.txt',
        tried: 'plain rebase',
      }),
    ],
  },
};

/** Opens the Add task popover, picks `base` for the first repo and files the task. */
export async function addTaskOnBase(page: Page, title: string, base: string): Promise<void> {
  await page.locator('[data-testid="ade-add"]').click();
  await page.locator('[data-testid="ade-nw-title"]').fill(title);
  await page.locator('[data-testid="ade-nw-base"] [data-testid="ade-base-picker"]').first().click();
  await page.locator(`[data-testid="ade-base-option-${base}"]`).click();
  await page.locator('[data-testid="ade-nw-add"]').click();
  await expect(page.locator('[data-testid="ade-add-popover"]')).toHaveCount(0);
}
