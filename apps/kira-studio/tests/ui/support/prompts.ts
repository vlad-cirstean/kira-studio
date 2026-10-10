import type { Page } from '@playwright/test';
import type { PromptKind, RoutedPrompt } from '@shared/domain/prompts';
import { IPC } from './ipcChannels';
import { emitWailsEvent } from './mockRuntime';

/** One routed prompt as the Go router pushes it; the UI suite's window key is `main`. */
export function routed(
  kind: PromptKind,
  ref: string,
  over: Partial<RoutedPrompt> = {},
): RoutedPrompt {
  return {
    id: `${kind}:${ref}`,
    kind,
    ref,
    origin: '',
    title: `${kind} ${ref}`,
    createdAt: 1,
    target: 'main',
    ...over,
  };
}

/** Pushes the router's whole prompt list (kira:prompts:changed). */
export function emitPrompts(page: Page, list: RoutedPrompt[]): Promise<void> {
  return emitWailsEvent(page, IPC.promptsChanged, list);
}
