import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, type Page } from '@playwright/test';
import { acquireBuildLock, getFreePort, waitForHealth } from '@workbench/testing/e2eReal';
import { bound } from './support/bound';
import { stubNativeDialogs } from './support/routes';

// Kira Space's real-backend tier: a `go build -tags server` binary on real SQLite, git, PTY and
// stream, reached by a plain browser page. The claude and gh CLIs are the fake agent
// (flowharness/fakeagent); dialogs, keep-awake and the window manager have no server-build
// counterpart.

const ROOT_DIR = resolve(__dirname, '../../../..');
const APP_DIR = resolve(ROOT_DIR, 'apps/kira-space');
const SERVER_BINARY = resolve(APP_DIR, 'bin/kira-space-server-test');
const FAKE_AGENT_BINARY = resolve(APP_DIR, 'bin/fakeclaude');

function envWithGoBin(): NodeJS.ProcessEnv {
  const extra = `${execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).trim()}/bin`;
  const path = process.env.PATH ?? '';
  return { ...process.env, PATH: path.includes(extra) ? path : `${path}:${extra}` };
}

// Idempotent and memoized per worker; the cross-process lock serializes concurrent workers.
let prerequisitesReady: Promise<void> | undefined;

function buildPrerequisites(): Promise<void> {
  prerequisitesReady ??= (async () => {
    const release = await acquireBuildLock();
    try {
      const env = envWithGoBin();
      const run = (cmd: string, args: string[], cwd = ROOT_DIR) =>
        execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
      run('sh', ['scripts/setup.sh']);
      run('bun', ['run', 'build:test:space']);
      if (!existsSync(resolve(APP_DIR, 'frontend/dist-mobile/index.html'))) {
        run('bun', ['run', 'build:space-mobile']);
      }
      await mkdir(resolve(APP_DIR, 'bin'), { recursive: true });
      run('go', ['build', '-tags', 'server', '-o', SERVER_BINARY, '.'], APP_DIR);
      run(
        'go',
        ['build', '-o', FAKE_AGENT_BINARY, './internal/flowharness/fakeagent/cmd/fakeclaude'],
        APP_DIR,
      );
    } finally {
      await release();
    }
  })();
  return prerequisitesReady;
}

export interface KiraSpaceApp {
  window: Page;
  baseURL: string;
  /** Per-test scratch root holding home, state and the repos a test creates. */
  root: string;
  /** Directory repos for this test live under. */
  work: string;
  /** Directory the fake agent records its calls into (KIRA_FAKE_DIR). */
  fakeDir: string;
  /** Calls a bound service method on the real server. */
  call<T>(service: string, method: string, args?: unknown): Promise<T>;
  /** Reloads the page, re-running boot against current server state. */
  reload(): Promise<void>;
}

interface KiraSpaceFixtures {
  consoleErrors: string[];
  scenario: object | undefined;
  kira: KiraSpaceApp;
}

export const test = base.extend<KiraSpaceFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
  consoleErrors: async ({}, use) => {
    await use([]);
  },

  scenario: [undefined, { option: true }],

  kira: async ({ browser, consoleErrors, scenario }, use) => {
    await buildPrerequisites();

    // Short root: unix-socket paths under it must stay below the sun_path limit.
    const root = await mkdtemp(join(tmpdir(), 'ksr-'));
    const home = join(root, 'home');
    const work = join(root, 'work');
    const binDir = join(root, 'bin');
    const fakeDir = join(root, 'fake');
    await Promise.all([home, work, binDir, fakeDir].map((d) => mkdir(d, { recursive: true })));
    await writeFile(
      join(home, '.gitconfig'),
      '[user]\n\tname = Flow Test\n\temail = flow@example.test\n[init]\n\tdefaultBranch = main\n',
    );
    await Promise.all([
      symlink(FAKE_AGENT_BINARY, join(binDir, 'claude')),
      symlink(FAKE_AGENT_BINARY, join(binDir, 'gh')),
    ]);
    const scenarioPath = join(root, 'scenario.json');
    await writeFile(scenarioPath, JSON.stringify(scenario ?? {}));

    const port = await getFreePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      KIRA_HOME: join(root, 'kira'),
      KIRA_SPACE_HOME: join(root, 'space'),
      KIRA_MEMORY_HOME: join(root, 'memory'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      TZ: 'UTC',
      KIRA_INSECURE_SECRETS: '1',
      KIRA_FAKE_DIR: fakeDir,
      KIRA_FAKE_SCEN: scenarioPath,
      // Loopback only: /wails/runtime has no authentication, so a server-mode binary exposes the
      // whole bound surface to anyone who can reach the port.
      WAILS_SERVER_HOST: '127.0.0.1',
      WAILS_SERVER_PORT: String(port),
    };

    const proc = spawn(SERVER_BINARY, [], {
      cwd: APP_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    const exited = new Promise<number | null>((r) => proc.once('exit', r));

    const baseURL = `http://127.0.0.1:${port}`;
    try {
      await Promise.race([
        waitForHealth(`${baseURL}/health`, 20_000),
        exited.then((code) => {
          throw new Error(
            `kira-space-server-test exited (code ${code}) before /health:\n${stderr.join('')}`,
          );
        }),
      ]);
    } catch (err) {
      proc.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
      throw err;
    }

    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await stubNativeDialogs(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    const url = `${baseURL}/?window=${crypto.randomUUID()}`;
    await page.goto(url);
    await page.waitForSelector('[data-testid="status-bar"]');

    await use({
      window: page,
      baseURL,
      root,
      work,
      fakeDir,
      call: (service, method, args) => bound(baseURL, service, method, args),
      reload: async () => {
        await page.goto(url);
        await page.waitForSelector('[data-testid="status-bar"]');
      },
    });

    await page.close();
    // SIGKILL: this tier does not test quit handshakes.
    proc.kill('SIGKILL');
    await exited;
    await rm(root, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';
