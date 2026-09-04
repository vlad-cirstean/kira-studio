/**
 * A Playwright-safe `linear()` (P3 W15) — a deliberate, minimal duplicate of
 * `tests/fixtures/generateRepo.ts`'s own `linear()`, not an import of it. That file is a Bun
 * fixture (`import.meta.dir`, used by its `large()`/`largeBranchy()` disk cache) loaded today
 * only from `bun test`; the pinned `@playwright/test@1.62.1` cannot load *any* module that
 * contains an `import.meta` reference at all, even one this function never reaches at runtime —
 * confirmed with a one-line repro spec — so importing it, even for just this one export, breaks
 * every VS Code spec's module graph. Real git, same determinism hygiene
 * (`GIT_CONFIG_*` isolation, fixed author identity, a fixed-step commit date) as the original,
 * trimmed to the one topology these specs need.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EPOCH_SECONDS = 1_700_000_000;
const STEP_SECONDS = 3600;
const AUTHOR_NAME = "Kira Fixture";
const AUTHOR_EMAIL = "fixture@kira-version.test";

export interface GeneratedRepo {
  readonly dir: string;
  readonly commits: readonly string[];
}

function baseEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: cwd,
  };
}

function git(dir: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: { ...baseEnv(dir), ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function linear(n: number): GeneratedRepo {
  const dir = mkdtempSync(join(tmpdir(), "kira-e2e-linear-"));
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=main"]);

  const commits: string[] = [];
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, "file.txt"), `line ${i}\n`);
    git(dir, ["add", "file.txt"]);
    const date = `${EPOCH_SECONDS + i * STEP_SECONDS} +0000`;
    git(dir, ["commit", "--quiet", "--no-gpg-sign", "-m", `commit ${i}`], {
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_DATE: date,
    });
    commits.push(git(dir, ["rev-parse", "HEAD"]).trim());
  }
  return { dir, commits };
}
