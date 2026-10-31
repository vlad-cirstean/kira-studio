import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// Preview answers the Go flow test wrote (flows/adeflow TestRunDialogPreview, contract ade-run),
// keyed by the exact vars the Run dialog sends for the T_alerts first step.

interface Preview {
  errors: unknown[];
  parts: { text: string; var: string; value: string }[];
}

const KEYS = ['step', 'space', 'finish'] as const;

export function runPreviewSnapshots(): ControlSnapshot[] {
  return KEYS.map((k) => ({
    channel: IPC.llmPromptsPreview,
    args: contract('ade-run', `args:LlmPromptsService.Preview#${k}`),
    response: contract('ade-run', `LlmPromptsService.Preview#${k}`),
  }));
}

/** A preview as one string: literal text and variable values. */
export function previewText(key: (typeof KEYS)[number]): string {
  return contract<Preview>('ade-run', `LlmPromptsService.Preview#${key}`)
    .parts.map((p) => (p.var === '' ? p.text : p.value))
    .join('');
}
