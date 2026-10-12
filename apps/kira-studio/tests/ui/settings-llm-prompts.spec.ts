import type { Page } from '@playwright/test';
import type { ContractJson } from '@workbench/testing/ui/contract';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { editorText } from './support/editorText';
import { IPC } from './support/ipcChannels';
import { openSettings } from './support/settings';

// P271: Settings > Prompts. Backend half: apps/kira-studio/internal/flows/llmpromptsflow; both halves
// read the contract scenario llm-prompts. The contract holds one entry per answer, so the full list
// below is built around it.

const SCENARIO = 'llm-prompts';
const listed = contract<ContractJson>(SCENARIO, 'LlmPromptsService.List#entry');
const saved = contract<ContractJson>(SCENARIO, 'LlmPromptsService.Save#entry');
const parts = contract<ContractJson>(SCENARIO, 'LlmPromptsService.Preview#parts');
const findings = contract<ContractJson>(SCENARIO, 'LlmPromptsService.Preview#errors');
const refused = contract<ContractJson>(SCENARIO, 'LlmPromptsService.Save#invalid');

const DEFAULT_TEXT = 'Default database MCP instructions.';
const STATUS_DEFAULT = '{{range .Results}}{{.ID}} {{end}}';
const BROKEN_DRAFT = '{{.From}} {{.Missing}}';
const BROKEN_STATUS = '{{range .Results}}{{.Nope}}{{end}}';
const CONFLICT = {
  code: 'E_CONFLICT',
  message: 'The prompt changed elsewhere. Refresh and apply your edit again.',
};

const editID: string = listed.id;
const statusID = 'headless.tool.finish_step.arg.status';
const editText: string = saved.text;

const instructions = { ...listed, defaultText: DEFAULT_TEXT, text: DEFAULT_TEXT };
const instructionsEdited = { ...saved, defaultText: DEFAULT_TEXT };
const finishStep = {
  ...listed,
  id: 'headless.tool.finish_step',
  kind: 'tool',
  name: 'finish_step',
  titleKey: '',
  purposeKey: '',
  usedByKey: '',
  hash: 'finish-step-hash',
  vars: [],
  defaultText: 'Report how this step ended.',
  text: 'Report how this step ended.',
};
const status = {
  ...listed,
  id: statusID,
  kind: 'argument',
  parent: finishStep.id,
  field: 'status',
  name: 'status',
  titleKey: '',
  purposeKey: '',
  usedByKey: '',
  hash: 'status-hash',
  vars: [{ name: 'Results', required: true, example: '[]' }],
  defaultText: STATUS_DEFAULT,
  text: STATUS_DEFAULT,
};

const promptList = (...prompts: ContractJson[]) => ({ prompts, storeError: '', revision: 0 });
const fresh = promptList(instructions, finishStep, status);
const afterSave = promptList(instructionsEdited, finishStep, status);
const afterReset = fresh;

const noFindings = { errors: [], parts: [] };
const row = (page: Page, id: string) =>
  page.locator(`[data-testid="llm-prompt-row"][data-id="${id}"]`);
const badges = (page: Page, id: string) =>
  row(page, id).locator('[data-testid="llm-prompt-badge"]');
const editor = (page: Page) => page.locator('[data-testid="llm-prompt-editor"]');

async function openPrompts(page: Page): Promise<void> {
  await openSettings(page);
  await page.locator('[data-testid="settings-section-Prompts"]').click();
}

const saveCalls = (control: { log(): { channel: string; args: unknown }[] }) =>
  control.log().filter((e) => e.channel === IPC.llmPromptsSave);

async function typeDraft(page: Page, text: string): Promise<void> {
  const host = editor(page);
  await host.locator('.view-lines').click();
  // The UI test pages report macOS, so Select All is Cmd+A.
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => editorText(host)).toBe(text);
}

const previewOf = (id: string, text: string | undefined, response: unknown) => ({
  channel: IPC.llmPromptsPreview,
  args: text === undefined ? { id } : { id, text },
  response,
});

test('lists this app’s prompts; an unedited prompt has no badge', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [{ channel: IPC.llmPromptsList, response: fresh }],
  });
  await openPrompts(window);

  await expect(window.locator('[data-testid="llm-prompt-row"]')).toHaveCount(2);
  await expect(row(window, editID)).toContainText('Database MCP instructions');
  await expect(row(window, finishStep.id)).toContainText('finish_step');
  await expect(badges(window, editID)).toHaveCount(0);
  await expect(
    window.locator(`[data-testid="llm-prompt-detail"][data-id="${editID}"]`),
  ).toBeVisible();
});

test('a broken draft shows the findings and blocks Save', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [
      { channel: IPC.llmPromptsList, response: fresh },
      previewOf(editID, undefined, noFindings),
      previewOf(editID, BROKEN_DRAFT, findings),
    ],
  });
  await openPrompts(window);
  await row(window, editID).click();
  await expect(window.locator('[data-testid="llm-prompt-error"]')).toHaveCount(0);

  await typeDraft(window, BROKEN_DRAFT);

  const errors = window.locator('[data-testid="llm-prompt-error"]');
  await expect(errors).toHaveCount(findings.errors.length);
  for (const [i, problem] of findings.errors.entries()) {
    await expect(errors.nth(i)).toContainText(problem.message);
  }
  await expect(window.locator('[data-testid="settings-save"]')).toBeDisabled();
});

test('a valid draft previews with variable chips and saves the contract payload', async ({
  relaunch,
}) => {
  const { window, control } = await relaunch({
    control: [
      { channel: IPC.llmPromptsList, response: fresh },
      { channel: IPC.llmPromptsList, response: afterSave },
      previewOf(editID, undefined, noFindings),
      previewOf(editID, editText, parts),
      { channel: IPC.llmPromptsSave, response: afterSave },
    ],
  });
  await openPrompts(window);
  await row(window, editID).click();
  await typeDraft(window, editText);
  await expect(badges(window, editID)).toHaveText('Edited');

  await window.locator('[data-testid="llm-prompt-tab-preview"]').click();
  const preview = window.locator('[data-testid="llm-prompt-preview"]');
  const chips = preview.locator('[data-testid="var-chip"]');
  const resolved = parts.parts.filter((p: ContractJson) => p.var !== '');
  await expect(chips).toHaveCount(resolved.length);
  for (const [i, p] of resolved.entries()) {
    await expect(chips.nth(i)).toHaveAttribute('data-var', p.var);
    await expect(chips.nth(i)).toContainText(p.value);
  }
  await expect(preview).toContainText(
    parts.parts.map((p: ContractJson) => (p.var === '' ? p.text : p.value)).join(''),
  );

  await window.locator('[data-testid="settings-save"]').click();
  await expect(window.locator('[data-testid="settings-dialog"]')).toHaveCount(0);
  const [save] = saveCalls(control);
  expect(save.args).toEqual({ changes: [{ id: editID, text: editText, baseHash: listed.hash }] });

  await openPrompts(window);
  await expect(badges(window, editID)).toHaveText('Edited');
});

test('a refused save shows the failure, keeps the dialog and the draft', async ({ relaunch }) => {
  const { window, control } = await relaunch({
    control: [
      { channel: IPC.llmPromptsList, response: fresh },
      {
        channel: IPC.llmPromptsSave,
        error: { code: refused.code, message: refused.message, details: refused.details },
      },
    ],
  });
  await openPrompts(window);
  await row(window, finishStep.id).click();
  const field = window.locator(`[data-testid="llm-prompt-arg"][data-id="${statusID}"] textarea`);
  await field.fill(BROKEN_STATUS);

  await window.locator('[data-testid="settings-save"]').click();

  await expect(window.locator('[data-testid="settings-save-error"]')).toHaveText(refused.message);
  await expect(window.locator('[data-testid="settings-dialog"]')).toBeVisible();
  await expect(field).toHaveValue(BROKEN_STATUS);
  const [save] = saveCalls(control);
  expect(save.args).toEqual({
    changes: [{ id: statusID, text: BROKEN_STATUS, baseHash: status.hash }],
  });
});

test('reset restores the default; saving it clears the badge', async ({ relaunch }) => {
  const { window, control } = await relaunch({
    control: [
      { channel: IPC.llmPromptsList, response: afterSave },
      { channel: IPC.llmPromptsList, response: afterReset },
      { channel: IPC.llmPromptsSave, response: afterReset },
    ],
  });
  await openPrompts(window);
  await row(window, editID).click();
  await expect(badges(window, editID)).toHaveText('Edited');
  await expect.poll(() => editorText(editor(window))).toBe(editText);

  await window.locator('[data-testid="llm-prompt-reset"]').click();

  await expect.poll(() => editorText(editor(window))).toBe(DEFAULT_TEXT);
  await expect(badges(window, editID)).toHaveCount(0);
  await window.locator('[data-testid="settings-save"]').click();
  await expect(window.locator('[data-testid="settings-dialog"]')).toHaveCount(0);
  const [save] = saveCalls(control);
  expect(save.args).toEqual({
    changes: [{ id: editID, text: DEFAULT_TEXT, baseHash: saved.hash }],
  });

  await openPrompts(window);
  await expect(badges(window, editID)).toHaveCount(0);
});

test('a conflict shows the error and keeps the draft', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [
      { channel: IPC.llmPromptsList, response: fresh },
      { channel: IPC.llmPromptsSave, error: CONFLICT },
    ],
  });
  await openPrompts(window);
  await row(window, editID).click();
  await typeDraft(window, editText);

  await window.locator('[data-testid="settings-save"]').click();

  await expect(window.locator('[data-testid="settings-save-error"]')).toHaveText(CONFLICT.message);
  await expect(window.locator('[data-testid="settings-dialog"]')).toBeVisible();
  await expect.poll(() => editorText(editor(window))).toBe(editText);
});
