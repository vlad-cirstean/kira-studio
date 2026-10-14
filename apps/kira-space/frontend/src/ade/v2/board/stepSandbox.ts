import type { SandboxAccess, StepSandbox } from '../wire';

export function defaultSandbox(): StepSandbox {
  return { access: 'write', read: [], allow: [], network: true };
}

export const ACCESS_MODES: readonly SandboxAccess[] = ['write', 'read', 'off'];

export const TOOLCHAINS = [
  { id: 'go', paths: ['~/go', '~/Library/Caches/go-build'] },
  { id: 'node', paths: ['~/.npm', '~/.nvm', '~/.bun'] },
  { id: 'rust', paths: ['~/.cargo', '~/.rustup'] },
  { id: 'python', paths: ['~/.pyenv', '~/Library/Caches/pip'] },
] as const;

/** One path per line; blank lines drop. */
export function parsePaths(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function formatPaths(paths: readonly string[]): string {
  return paths.join('\n');
}

export function pathsValid(paths: readonly string[]): boolean {
  return paths.every((p) => p.startsWith('/') || p === '~' || p.startsWith('~/'));
}

export function addPaths(paths: readonly string[], add: readonly string[]): string[] {
  return [...paths, ...add.filter((p) => !paths.includes(p))];
}
