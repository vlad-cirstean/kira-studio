import { expect, type Locator, type Page } from '@playwright/test';

// Shared steps of both apps' settings-llm-prompts specs (Settings > Prompts).

export const promptRow = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="llm-prompt-row"][data-id="${id}"]`);

export const promptBadges = (page: Page, id: string): Locator =>
  promptRow(page, id).locator('[data-testid="llm-prompt-badge"]');

export const promptEditor = (page: Page): Locator =>
  page.locator('[data-testid="llm-prompt-editor"]');

/** Monaco virtualises its lines: the full text is read from the debug attribute on the host. */
export async function promptEditorText(host: Locator): Promise<string> {
  const root = host.locator('.monaco-host');
  await expect(root).toHaveAttribute('data-kira-editor-text', /^[\s\S]*$/);
  return (await root.getAttribute('data-kira-editor-text')) ?? '';
}

/** Replaces the selected prompt's text in the editor. */
export async function typeDraft(page: Page, text: string): Promise<void> {
  const host = promptEditor(page);
  await host.locator('.view-lines').click();
  // The UI test pages report macOS, so Select All is Cmd+A.
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => promptEditorText(host)).toBe(text);
}

/** A Preview answer for one request: `text` undefined matches the call with no draft. */
export function previewAnswer(
  channel: string,
  id: string,
  text: string | undefined,
  response: unknown,
) {
  return { channel, args: text === undefined ? { id } : { id, text }, response };
}
