import type { Page } from '@playwright/test';
import { runtimeErrorBody } from '@workbench/testing/ui/mockRuntime';

export interface DockerMockError {
  error: { code: string; message: string; details?: unknown };
}

/** Answers one bound `DockerService` method: the value to return, or `{ error }` to fail it. */
export type DockerHandler = (args: unknown) => unknown | DockerMockError | Promise<unknown>;

export interface InstallDockerMocksOptions {
  /** The app's bridge package path, as in its own `tests/ui/support/mockRuntime.ts`. */
  bridgePkg: string;
  handlers: Readonly<Record<string, DockerHandler>>;
}

export interface DockerMockHandle {
  /** Every `DockerService` call answered, in order. */
  calls(method?: string): Array<{ method: string; args: unknown }>;
}

const FIRE_AND_FORGET = [
  'Watch',
  'Unwatch',
  'StatsSubscribe',
  'StatsUnsubscribe',
  'LogsOpen',
  'LogsClose',
  'ExecWrite',
  'ExecResize',
  'ExecClose',
];

const isMockError = (v: unknown): v is DockerMockError =>
  typeof v === 'object' && v !== null && 'error' in v;

/**
 * Registers a `page.route` for `DockerService.*` bound calls. Playwright runs later routes first,
 * so call this after `relaunch()`; every other `/wails/` request falls through to the app's own
 * control mocks. Pushed events go through `emitWailsEvent` (`@workbench/testing/ui/mockRuntime`).
 */
export async function installDockerMocks(
  page: Page,
  options: InstallDockerMocksOptions,
): Promise<DockerMockHandle> {
  const prefix = `${options.bridgePkg}.DockerService.`;
  const log: Array<{ method: string; args: unknown }> = [];

  await page.route('**/wails/runtime', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = JSON.parse(request.postData() ?? '{}') as {
      args?: { methodName?: string; args?: unknown[] };
    };
    const name = body.args?.methodName;
    if (!name?.startsWith(prefix)) return route.fallback();

    const method = name.slice(prefix.length);
    const args = body.args?.args?.[0];
    log.push({ method, args });

    const handler = options.handlers[method];
    if (!handler) {
      if (FIRE_AND_FORGET.includes(method) || method === 'Contexts') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: method === 'Contexts' ? '[]' : 'null',
        });
      }
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: runtimeErrorBody('E_FIXTURE_MISS', `no docker mock handler for ${method}`),
      });
    }
    const result = await handler(args);
    if (isMockError(result)) {
      const { code, message, details } = result.error;
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: runtimeErrorBody(code, message, details),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: result === undefined ? 'null' : JSON.stringify(result),
    });
  });

  return {
    calls: (method) => (method ? log.filter((c) => c.method === method) : log),
  };
}
