import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FIXED_DATE = '2026-01-01T00:00:00Z';

/** Runs real git in `cwd` with fixed identity and dates, so a repo's shas are stable. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Flow Test',
      GIT_AUTHOR_EMAIL: 'flow@example.test',
      GIT_COMMITTER_NAME: 'Flow Test',
      GIT_COMMITTER_EMAIL: 'flow@example.test',
      GIT_AUTHOR_DATE: FIXED_DATE,
      GIT_COMMITTER_DATE: FIXED_DATE,
    },
  }).trim();
}

/** Creates a real repo on `main` with one commit per `[path, content]` entry. */
export async function createRepo(
  dir: string,
  commits: ReadonlyArray<{ subject: string; files: Record<string, string> }>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const c of commits) {
    for (const [path, content] of Object.entries(c.files)) {
      const abs = join(dir, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', c.subject);
  }
}
