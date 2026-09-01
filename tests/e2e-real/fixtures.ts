import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, type Page } from '@playwright/test';

// The tests/e2e-real/ counterpart to tests/e2e/fixtures.ts's `_electron.launch()`
// (P57-e2e-revisit.md §8). There is no Electron process and no native window: `relaunch`-equivalent
// setup here means "build (if needed) and spawn a `go build -tags server` binary, wait for it to
// answer /health, then open a plain browser page against it" — a real Go backend, a real embedded
// engine, a real database adapter, reached over plain HTTP/WebSocket (§1/§3).

const ROOT_DIR = resolve(__dirname, '../..');
const SHELL_DIR = resolve(ROOT_DIR, 'apps/kira-studio');
const SERVER_BINARY = resolve(SHELL_DIR, 'bin/kira-server-test');
// Serializes the actual prerequisite-build filesystem writes (apps/kira-studio/frontend/dist, the compiled
// binary) across worker *processes* — the in-module memo below only dedupes within one process.
// Two `e2e-real` workers building at once would otherwise race on the same output paths.
const LOCK_PATH = resolve(ROOT_DIR, '.e2e-real-build.lock');

function goBinDir(): string {
  return `${execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).trim()}/bin`;
}

// `scripts/wails-dev-setup.sh` installs `wails3` via `go install` and expects it on PATH
// afterward (predev:wails's own shell-profile note) — set explicitly here so this fixture never
// depends on the invoking shell having done that.
function envWithGoBin(): NodeJS.ProcessEnv {
  const extra = goBinDir();
  const path = process.env.PATH ?? '';
  return { ...process.env, PATH: path.includes(extra) ? path : `${path}:${extra}` };
}

async function acquireBuildLock(): Promise<() => Promise<void>> {
  for (;;) {
    try {
      const handle = await open(LOCK_PATH, 'wx');
      await handle.close();
      return () => rm(LOCK_PATH, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// Build prerequisites, all idempotent (P57-e2e-revisit.md §8/§10): `scripts/wails-dev-setup.sh`
// (pinned wails3, generated bindings — no vendored Node runtime or bundled engine to check for
// since P58f) plus `bun run build` (apps/kira-studio/frontend/dist, which main.go's `//go:embed
// all:frontend/dist` picks up), then the one step those scripts don't do — `go build -tags
// server`. Memoized per worker process so a spec file with multiple tests builds once, not once
// per test.
let prerequisitesReady: Promise<void> | undefined;

function buildPrerequisites(): Promise<void> {
  prerequisitesReady ??= (async () => {
    const release = await acquireBuildLock();
    try {
      const env = envWithGoBin();
      execFileSync('sh', ['scripts/wails-dev-setup.sh'], { cwd: ROOT_DIR, env, stdio: 'inherit' });
      // `build:wails` (a separate `vite.wails.config.ts`) was folded into the main `vite build`
      // once P57 removed Electron — this repo's own `vite.config.ts` already outputs straight to
      // `apps/kira-studio/frontend/dist`, main.go's `//go:embed` target.
      execFileSync('bun', ['run', 'build'], { cwd: ROOT_DIR, env, stdio: 'inherit' });
      await mkdir(resolve(SHELL_DIR, 'bin'), { recursive: true });
      execFileSync('go', ['build', '-tags', 'server', '-o', SERVER_BINARY, '.'], {
        cwd: SHELL_DIR,
        env,
        stdio: 'inherit',
      });
    } finally {
      await release();
    }
  })();
  return prerequisitesReady;
}

// Per-test port (D3: proven sufficient for parallel isolation alongside a per-test KIRA_HOME) —
// bind a real listener to port 0 to get one the OS guarantees is free, then hand it to the
// spawned binary instead of that listener.
async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet — keep polling rather than sleeping a fixed guess (§8).
    }
    if (Date.now() > deadline) {
      throw new Error(`kira-server-test did not answer ${url} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export interface KiraApp {
  window: Page;
  baseURL: string;
}

interface KiraFixtures {
  kiraHome: string;
  consoleErrors: string[];
  kira: KiraApp;
}

export const test = base.extend<KiraFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
  kiraHome: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'kira-e2e-real-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
  consoleErrors: async ({}, use) => {
    await use([]);
  },

  kira: async ({ browser, kiraHome, consoleErrors }, use) => {
    // Non-negotiable per tests/e2e/fixtures.ts's own precedent (P25 D10): a real ~/.kira-studio
    // must never be touched by a test run.
    if (!kiraHome.startsWith(tmpdir())) {
      throw new Error(`KIRA_HOME fixture "${kiraHome}" is not under the OS tmpdir`);
    }

    await buildPrerequisites();

    const port = await getFreePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KIRA_HOME: kiraHome,
      // Linux has no real keychain backing (AGENTS.md) — same Linux-only development fallback
      // tests/e2e/fixtures.ts already sets, a no-op on macOS.
      KIRA_INSECURE_SECRETS: '1',
      // Non-negotiable (§8): bind to 127.0.0.1 always, set explicitly rather than trusted as a
      // default. There is no authentication of any kind on /wails/runtime — a server-mode binary
      // exposes the entire bound surface, secrets and file services included, to anyone who can
      // reach the port. This binary is a test artifact and must never be reachable beyond
      // loopback, let alone packaged or shipped.
      WAILS_SERVER_HOST: '127.0.0.1',
      WAILS_SERVER_PORT: String(port),
    };

    const proc = spawn(SERVER_BINARY, [], {
      cwd: SHELL_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk.toString());
      process.stderr.write(chunk);
    });
    const exited = new Promise<number | null>((r) => proc.once('exit', r));

    const baseURL = `http://127.0.0.1:${port}`;
    try {
      await Promise.race([
        waitForHealth(`${baseURL}/health`, 20_000),
        exited.then((code) => {
          throw new Error(
            `kira-server-test exited (code ${code}) before /health:\n${stderr.join('')}`,
          );
        }),
      ]);
    } catch (err) {
      proc.kill('SIGKILL');
      throw err;
    }

    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${baseURL}/`);
    await page.waitForSelector('[data-testid="status-bar"]');

    await use({ window: page, baseURL });

    await page.close();
    // SIGKILL, not a graceful shutdown (§8) — this tier does not test lifecycle/quit handshakes
    // (that's explicitly out of scope, §4), and a process left to its own OnShutdown hooks between
    // tests is exactly the kind of teardown flakiness this fixture doesn't need to own.
    proc.kill('SIGKILL');
    await exited;
  },
});

export { expect } from '@playwright/test';
