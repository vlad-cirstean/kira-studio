import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { defaultLayout } from '@shared/domain/layout';
import { defaultSettings } from '@shared/domain/settings';
import { IPC } from './ipcChannels';
import type { ControlSnapshot } from './types';

// The real Wails runtime, served under /wails/ — Kira Studio's own tests/ui/support/mockRuntime.ts,
// ported and trimmed to this app's own bound surface (bridge/index.ts's `control` object,
// apps/kira-space/main.go's 10 services). See that file's own header comment for why this is the
// real runtime.js bundle, not a hand-rolled stand-in, and why `go list` resolves its path rather
// than a hand-written GOPATH-shaped one.
const WAILS_MODULE_DIR = execFileSync(
  'go',
  ['list', '-m', '-f', '{{.Dir}}', 'github.com/wailsapp/wails/v3'],
  { cwd: resolve(__dirname, '../../../'), encoding: 'utf8' },
).trim();
const WAILS_RUNTIME_JS = resolve(WAILS_MODULE_DIR, 'internal/assetserver/bundledassets/runtime.js');

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge';

// One line per request/response channel — the FQN half of each pair, read off the generated
// bindings themselves (`grep -rhoE '\$Call\.ByName\("[^"]+"' apps/kira-space/frontend/bindings/…/bridge/*.js`),
// not retyped from memory — the same discipline Kira Studio's own copy of this table follows.
const FQN_SUFFIX_BY_IPC_KEY: Record<string, string> = {
  githubOpenPullRequestUrl: 'GitHubService.OpenPullRequestURL',
  linkOpenExternal: 'LinkService.OpenExternal',
  settingsGetAll: 'SettingsService.GetAll',
  settingsSet: 'SettingsService.Set',
  layoutGetAll: 'LayoutService.GetAll',
  layoutSet: 'LayoutService.Set',
  appFlushed: 'LifecycleService.Flushed',
  windowFlushed: 'LifecycleService.WindowFlushed',
  filesChooseFolder: 'FilesService.ChooseFolder',
  gitClientsList: 'GitClientsService.List',
  gitClientsRevoke: 'GitClientsService.Revoke',
  gitPairingPending: 'GitClientsService.PendingPairing',
  gitPairingApprove: 'GitClientsService.Approve',
  gitPairingDeny: 'GitClientsService.Deny',
  gitVsixStatus: 'GitClientsService.VsixStatus',
  gitVsixInstall: 'GitClientsService.InstallVsCodeIntegration',
  tabsList: 'TabsService.List',
  tabsSave: 'TabsService.Save',
  codeWorkspaceListRepos: 'CodeWorkspaceService.ListRepos',
  codeWorkspaceRepoHeads: 'CodeWorkspaceService.RepoHeads',
  codeWorkspaceRepoWorktreeLinks: 'CodeWorkspaceService.RepoWorktreeLinks',
  codeWorkspaceImportRepo: 'CodeWorkspaceService.ImportRepo',
  codeWorkspaceRenameRepo: 'CodeWorkspaceService.RenameRepo',
  codeWorkspaceRemoveRepo: 'CodeWorkspaceService.RemoveRepo',
  codeWorkspaceListFiles: 'CodeWorkspaceService.ListFiles',
  codeWorkspaceReadFile: 'CodeWorkspaceService.ReadFile',
  codeWorkspaceOpenWorkspace: 'CodeWorkspaceService.OpenWorkspace',
  codeWorkspaceCloseWorkspace: 'CodeWorkspaceService.CloseWorkspace',
  codeWorkspaceReadDiff: 'CodeWorkspaceService.ReadDiff',
  codeWorkspaceStartSearch: 'CodeWorkspaceService.StartSearch',
  codeWorkspaceCancelSearch: 'CodeWorkspaceService.CancelSearch',
  terminalDefaultCwd: 'TerminalService.DefaultCwd',
  terminalOpen: 'TerminalService.Open',
  terminalWrite: 'TerminalService.Write',
  terminalResize: 'TerminalService.Resize',
  terminalClose: 'TerminalService.Close',
};

export const CHANNEL_TO_FQN: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(FQN_SUFFIX_BY_IPC_KEY).map(([key, suffix]) => [
      IPC[key as keyof typeof IPC],
      `${BRIDGE_PKG}.${suffix}`,
    ]),
  ),
);

const FQN_TO_CHANNEL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(CHANNEL_TO_FQN).map(([channel, fqn]) => [fqn, channel])),
);

// A call this mock never expects a fixture to cover, answered the same way regardless of a
// spec's own args — pre-serialised JSON, keyed by channel; used only when a channel has *no*
// fixture-supplied snapshot at all (a spec that provides its own still wins). Every member here is
// one of main.ts's own unconditional-every-boot Promise.all calls (bootstrap()'s own doc comment)
// no committed fixture will ever snapshot, or a fire-and-forget call no spec asserts on the echo
// of — the same reasoning Kira Studio's own WILDCARD_DEFAULTS carries per entry, trimmed to this
// app's own boot sequence (this app has no windowsEnsure/WindowsService at all, so unlike Studio's
// copy there is no inferredBootMode special case here).
const WILDCARD_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  [IPC.tabsSave]: 'null',
  [IPC.layoutSet]: JSON.stringify(defaultLayout),
  [IPC.settingsSet]: JSON.stringify(defaultSettings),
  [IPC.gitClientsList]: '[]',
  [IPC.gitPairingPending]: JSON.stringify({ pending: null, queued: 0 }),
  [IPC.gitVsixStatus]: JSON.stringify({
    bundled: false,
    vsixPath: '',
    codeAvailable: false,
    probed: [],
    command: '',
  }),
  [IPC.codeWorkspaceListRepos]: '[]',
  [IPC.codeWorkspaceRepoHeads]: '[]',
  [IPC.codeWorkspaceRepoWorktreeLinks]: '[]',
  [IPC.terminalDefaultCwd]: JSON.stringify({ path: '/home/test' }),
  [IPC.codeWorkspaceOpenWorkspace]: 'null',
  [IPC.codeWorkspaceCloseWorkspace]: 'null',
  [IPC.codeWorkspaceCancelSearch]: 'null',
});

interface CallRequestBody {
  object: number;
  method: number;
  args?: {
    'call-id': string;
    methodName?: string;
    args?: unknown[];
  };
}

// Structured clone preserves a key whose value is `undefined`; the wire format here is JSON,
// which drops it outright — both are normalised the same way before comparing, so a fixture
// recorded from either transport matches. `windowKey`/`tabId` are excluded outright — a per-window
// or per-tab id this app generates at runtime, never reproducible from a fixture.
function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'windowKey' || key === 'tabId' || key === 'terminalId') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = v;
    }
    return JSON.stringify(out);
  }
  return JSON.stringify(value);
}

function runtimeErrorBody(code: string, message: string, details?: unknown): string {
  // The exact shape apps/kira-space/internal/bridge's own transport_http.go equivalent writes for
  // a bound method's error — `.message` is ipcerr.Error's own JSON encoding, `.cause` is that same
  // {code, message} as a real object. control.ts's `unwrap` reads `.cause` first, so a fixture miss
  // surfaces as a diagnosable `E_FIXTURE_MISS`, not a raw network failure.
  const body: Record<string, unknown> = { code, message };
  if (details !== undefined) body.details = details;
  return JSON.stringify({
    kind: 'RuntimeError',
    message: JSON.stringify(body),
    cause: body,
  });
}

export interface ControlLogEntry {
  channel: string;
  args: unknown;
}

export interface ControlMockHandle {
  /** Every Call this mock actually answered, in order. */
  log(): ControlLogEntry[];
}

let cachedRuntimeJs: Buffer | undefined;

async function serveWailsRuntimeJs(route: Route): Promise<void> {
  cachedRuntimeJs ??= await readFile(WAILS_RUNTIME_JS);
  await route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: cachedRuntimeJs,
  });
}

/**
 * Replaces the control channel's answers at the network layer — `page.route` intercepts every
 * request under `/wails/`: the real runtime bundle itself (served for real, off disk — see
 * `serveWailsRuntimeJs` above) and the one RPC endpoint bound calls POST to. The mocked HTTP
 * response is exactly what `unwrap`/`trust` in `bridge/rpc.ts` are written to consume, so a
 * frontend spec still exercises that code for real.
 */
export async function installControlMocks(
  page: Page,
  snapshots: readonly ControlSnapshot[],
): Promise<ControlMockHandle> {
  const log: ControlLogEntry[] = [];
  const byChannel = new Map<string, ControlSnapshot[]>();
  for (const snap of snapshots) {
    const list = byChannel.get(snap.channel) ?? [];
    list.push(snap);
    byChannel.set(snap.channel, list);
  }
  const byKey = new Map<string, Map<string, ControlSnapshot[]>>();
  for (const [channel, list] of byChannel) {
    const grouped = new Map<string, ControlSnapshot[]>();
    for (const snap of list) {
      const key = canonical(snap.args);
      const group = grouped.get(key) ?? [];
      group.push(snap);
      grouped.set(key, group);
    }
    byKey.set(channel, grouped);
  }
  const cursors = new Map<string, number>();

  await page.route('**/wails/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/wails/runtime.js') {
      await serveWailsRuntimeJs(route);
      return;
    }

    // The runtime bundle's own last line (runtime.js's `loadOptionalScript`) HEADs this once per
    // page load, unconditionally — see Kira Studio's own mockRuntime.ts for the full reasoning.
    if (url.pathname === '/wails/custom.js') {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      return;
    }

    if (url.pathname !== '/wails/runtime' || request.method() !== 'POST') {
      await route.fulfill({
        status: 501,
        contentType: 'text/plain',
        body: `unmocked ${request.method()} ${url.pathname}`,
      });
      return;
    }

    const body = JSON.parse(request.postData() ?? '{}') as CallRequestBody;
    const methodName = body.args?.methodName;
    const channel = methodName ? FQN_TO_CHANNEL[methodName] : undefined;
    const callArgs = body.args?.args?.[0];

    if (!channel) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: runtimeErrorBody('E_FIXTURE_MISS', `no CHANNEL_TO_FQN entry for ${methodName}`),
      });
      return;
    }
    log.push({ channel, args: callArgs });

    const grouped = byKey.get(channel);
    const list = byChannel.get(channel) ?? [];
    function findSnap(args: unknown): ControlSnapshot | undefined {
      if (!grouped) return undefined;
      const key = canonical(args);
      const group = grouped.get(key);
      if (!group) return undefined;
      const at = cursors.get(`${channel}:${key}`) ?? 0;
      cursors.set(`${channel}:${key}`, at + 1);
      return group[Math.min(at, group.length - 1)];
    }
    const snap = list.length === 1 ? list[0] : findSnap(callArgs);
    if (!snap) {
      const wildcard = WILDCARD_DEFAULTS[channel];
      if (wildcard !== undefined) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: wildcard });
        return;
      }
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: runtimeErrorBody(
          'E_FIXTURE_MISS',
          `no fixture snapshot for ${channel} args ${JSON.stringify(callArgs)}`,
        ),
      });
      return;
    }
    if (snap.error) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: runtimeErrorBody(snap.error.code, snap.error.message, snap.error.details),
      });
      return;
    }
    const responseBody = snap.response === undefined ? 'null' : JSON.stringify(snap.response);
    await route.fulfill({ status: 200, contentType: 'application/json', body: responseBody });
  });

  return { log: () => log };
}

/**
 * Delivers a pushed Wails event into a page that has real runtime.js loaded — the piece
 * `installControlMocks` above deliberately does not cover (it intercepts only the `Call` RPC
 * endpoint). The bundle exposes `window._wails.dispatchWailsEvent({name, data})` for exactly this
 * shape: `name` is the same channel string `bridge/rpc.ts`'s `on(...)` subscribes `Events.On` to
 * (e.g. `CHANNEL.terminal`), `data` is whatever that channel's own `cb(ev.data)` expects.
 */
export async function emitWailsEvent(page: Page, name: string, data: unknown): Promise<void> {
  await page.evaluate(
    ({ name, data }) => {
      (
        window as unknown as {
          _wails: { dispatchWailsEvent(e: { name: string; data: unknown }): void };
        }
      )._wails.dispatchWailsEvent({ name, data });
    },
    { name, data },
  );
}
