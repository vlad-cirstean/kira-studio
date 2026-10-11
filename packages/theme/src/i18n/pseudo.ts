import type { CopyLocale } from './types';

export type MessageTree = { [key: string]: string | MessageTree };

// Wraps each plural branch; placeholders stay intact so interpolation still works.
function pseudoMessage(message: string): string {
  return message
    .split('|')
    .map((branch) => `⟦${branch.trim()}⟧`)
    .join(' | ');
}

export function pseudoMessages<T extends MessageTree>(source: T): T {
  const out: MessageTree = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = typeof value === 'string' ? pseudoMessage(value) : pseudoMessages(value);
  }
  return out as T;
}

declare global {
  interface Window {
    __kiraSetLocale?: (locale: CopyLocale) => void;
  }
}
