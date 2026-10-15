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

/** Normalizes `.` and `..` segments, like Go's `path.Clean`. */
function cleanPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!p.startsWith('/')) out.push('..');
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  return p.startsWith('/') ? `/${joined}` : joined || '.';
}

/** Mirrors the workflow parser: roots, home, ~/Library, ~/.claude and the keychain directory are refused. */
function isProtectedPath(p: string): boolean {
  const c = cleanPath(p);
  if (['/', '~', '~/Library', '~/.claude', '.'].includes(c)) return true;
  return c.startsWith('..') || `${c}/`.startsWith('~/Library/Keychains/');
}

export function pathsValid(paths: readonly string[]): boolean {
  return paths.every(
    (p) => (p.startsWith('/') || p === '~' || p.startsWith('~/')) && !isProtectedPath(p),
  );
}

export function addPaths(paths: readonly string[], add: readonly string[]): string[] {
  return [...paths, ...add.filter((p) => !paths.includes(p))];
}
