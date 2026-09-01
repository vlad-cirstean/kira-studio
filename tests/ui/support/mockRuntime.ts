import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { defaultLayout } from '@shared/domain/layout';
import { defaultSettings } from '@shared/domain/settings';
import type { ControlSnapshot } from '../../ipc/support/types';
import { IPC } from './ipcChannels';

// The real Wails runtime, served under /wails/ so the app's own `import ... from
// '/wails/runtime.js'` (control.ts, port.ts, every generated binding) loads real
// Call/Events/Stream/JSONStream logic in the browser — not a hand-rolled stand-in of it.
//
// This is NOT `node_modules/@wailsio/runtime/dist/index.js` — that package is the *unbundled* ESM
// source (a dozen files, each `import`ing its siblings by relative path), meant to be bundled
// together with the rest of the app at Vite/esbuild build time, the way the generated bindings
// already are. A real packaged Wails app serves something else entirely at the literal URL
// `/wails/runtime.js`: a single, dependency-free, pre-minified bundle the `wails3` CLI embeds,
// found by actually reading the pinned module (P57 finding — tried serving the npm package's
// dist/ tree directly first; a same-name collision surfaced immediately: `calls.js`'s own `import
// … from "./runtime.js"` resolves, relative to its own URL `/wails/calls.js`, to the exact same
// `/wails/runtime.js` path the *app* imports for the aggregate bundle, but needs the low-level
// dist/runtime.js file instead — two different files, one URL, unresolvable by aliasing alone).
// `go list` resolves the on-disk path for whatever version go.mod actually pins, rather than
// hand-writing a GOPATH-shaped path that would silently go stale on a version bump.
const WAILS_MODULE_DIR = execFileSync(
  'go',
  ['list', '-m', '-f', '{{.Dir}}', 'github.com/wailsapp/wails/v3'],
  { cwd: resolve(__dirname, '../../../apps/kira-studio'), encoding: 'utf8' },
).trim();
const WAILS_RUNTIME_JS = resolve(WAILS_MODULE_DIR, 'internal/assetserver/bundledassets/runtime.js');

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge';

// One line per request/response channel — the FQN half of each pair, read off the generated
// bindings themselves (`grep -rhoE '\$Call\.ByName\("[^"]+"' apps/kira-studio/frontend/bindings/.../bridge/*.ts`),
// not retyped from memory. `connectionsDelete`'s Go-side name is `Remove`, not `Delete` (P57
// §1.9) — the one place key and value genuinely disagree.
const FQN_SUFFIX_BY_IPC_KEY: Record<string, string> = {
  appInfo: 'AppService.Info',
  settingsGetAll: 'SettingsService.GetAll',
  settingsSet: 'SettingsService.Set',
  layoutGetAll: 'LayoutService.GetAll',
  layoutSet: 'LayoutService.Set',
  engineStatus: 'EngineService.Status',
  appFlushed: 'LifecycleService.Flushed',
  filesChooseSave: 'FilesService.ChooseSave',
  filesChooseOpen: 'FilesService.ChooseOpen',
  connectionsList: 'ConnectionsService.List',
  connectionsCreate: 'ConnectionsService.Create',
  connectionsUpdate: 'ConnectionsService.Update',
  connectionsDuplicate: 'ConnectionsService.Duplicate',
  connectionsDelete: 'ConnectionsService.Remove',
  connectionsReorder: 'ConnectionsService.Reorder',
  connectionsReveal: 'ConnectionsService.Reveal',
  connectionsSecretsStatus: 'ConnectionsService.SecretsStatus',
  connectionsTest: 'ConnectionsService.Test',
  connectionsConnect: 'ConnectionsService.Connect',
  connectionsDisconnect: 'ConnectionsService.Disconnect',
  connectionsStates: 'ConnectionsService.States',
  treeChildren: 'TreeService.Children',
  treeDescribe: 'TreeService.Describe',
  treeDefinition: 'TreeService.Definition',
  treeInvalidate: 'TreeService.Invalidate',
  filtersList: 'FiltersService.List',
  filtersReplace: 'FiltersService.Replace',
  opsRecent: 'OpsService.Recent',
  opsCancel: 'OpsService.Cancel',
  tabsList: 'TabsService.List',
  tabsSave: 'TabsService.Save',
  queriesList: 'QueriesService.List',
  queriesSave: 'QueriesService.Save',
  queriesListConsole: 'QueriesService.ListConsole',
  queriesSaveConsole: 'QueriesService.SaveConsole',
  queriesUpdate: 'QueriesService.Update',
  queriesDelete: 'QueriesService.Delete',
  queriesTouch: 'QueriesService.Touch',
  queriesHistoryList: 'QueriesService.HistoryList',
  queriesHistoryRecord: 'QueriesService.HistoryRecord',
};

/** ipc.ts's legacy channel string (what every `ControlSnapshot.channel` and fixture is keyed by,
 *  P50 D5/D15) mapped onto the FQN `$Call.ByName` actually sends over the wire today. This table
 *  is the one piece of new coupling P57's bridge rewrite introduces (§4.10) — §5.5's
 *  `mockRuntime.spec.ts` guards both directions: every value here must appear in the generated
 *  bindings' own `$Call.ByName("…")` literals, and every channel any committed fixture uses must
 *  have an entry. */
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
// fixture-supplied snapshot at all (a spec that provides its own still wins). Every member here
// is a call `tests/ipc/**/*.fixture.ts` never captures because the pre-P57 mock
// (`tests/ipc/support/mockControl.ts`) only overrode the channels it had snapshots for —
// everything else fell through to a real (if temporary) backend, so these are that same
// no-op/empty answer made explicit, not a gap in the fixtures:
//   - `filtersList`: `project/state/tree.ts` calls it once for every connection the instant it
//     reaches `connected` (tree.ts:118) — "no filters yet" for a connection never seen before,
//     `EMPTY_VISIBILITY` (`shared/domain/tree-filter.ts`) made explicit.
//   - `tabsSave`: `state/tabs.ts` debounce-persists on every tab mutation (typing in a console
//     tab, opening/closing a tab, …) with a tab array keyed by a fresh UUID every test run —
//     never a value any committed fixture could match on args, so it cannot be captured even in
//     principle. Void.
//   - `layoutSet`/`settingsSet`: the same debounced-persist shape as `tabsSave`, for panel
//     resizes/toggles and settings edits — echoed back as the untouched default, since no ipc
//     frontend spec asserts on the echo itself.
//   - `opsCancel`/`queriesHistoryRecord`: fire-and-forget, `opId`/free-form-filter args a spec
//     never asserts on. Void.
//   - `treeDescribe`: `views/grid/state.ts`'s `loadMeta` calls it once per data tab opened,
//     purely to feed the projection menu — wrapped in its own `try { … } catch {}` ("a failure
//     here must not block reading rows", the function's own comment), so a real, uncaptured miss
//     already degrades silently in the app; this just stops it from also being *loud* at the
//     network layer. The placeholder `ObjectMeta` is never read by anything a spec asserts on.
//   - `queriesList`/`queriesListConsole`/`queriesHistoryList`: unlike `treeDescribe`, these are
//     NOT caught — `project/state/tree.ts`'s `loadSavedQueries` runs uncaught "right before
//     opening a relation's context menu" (its own comment), so a real miss here doesn't just
//     degrade a menu, it silently stops the context menu from opening at all. "No saved queries
//     yet for a path never seen before" is the correct empty-list answer regardless.
// Mirrors `mockStreamBrowser.js`'s own `'ping'` special case for the identical reason.
const EMPTY_OBJECT_META = {
  path: '',
  kind: 'table',
  name: '',
  qualifiedName: '',
  columns: [],
  primaryKey: null,
  foreignKeys: [],
  referencedBy: [],
  indexes: [],
  rowEstimate: null,
  comment: null,
};
const WILDCARD_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  [IPC.filtersList]: JSON.stringify({ hiddenKinds: [], hiddenPaths: [] }),
  [IPC.tabsSave]: 'null',
  [IPC.layoutSet]: JSON.stringify(defaultLayout),
  [IPC.settingsSet]: JSON.stringify(defaultSettings),
  [IPC.opsCancel]: 'null',
  [IPC.queriesHistoryRecord]: 'null',
  [IPC.treeDescribe]: JSON.stringify({ meta: EMPTY_OBJECT_META, source: 'server' }),
  [IPC.queriesList]: '[]',
  [IPC.queriesListConsole]: '[]',
  [IPC.queriesHistoryList]: '[]',
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

// Structured clone (what ipcRenderer.invoke actually used, pre-P57) preserves a key whose value
// is `undefined`; the wire format here is JSON, which drops it outright — both are normalised the
// same way before comparing, so a fixture recorded from either transport matches. `tabId` is
// excluded outright — a per-tab UUID the renderer generates at tab-open time, never reproducible
// from a fixture (same reasoning mockPort.ts's own matchKey already applies).
function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'tabId') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      // `refresh` defaults to `false` at every call site (control.ts's own `refresh ?? false`),
      // so a live call always carries it explicitly — but a captured fixture snapshot can predate
      // that default becoming part of the args shape and simply omit the key. Normalising a
      // `false` value the same as an absent key means the two compare equal, the same way
      // `v !== undefined` already does for every other field.
      if (key === 'refresh' && v === false) continue;
      out[key] = v;
    }
    return JSON.stringify(out);
  }
  return JSON.stringify(value);
}

function runtimeErrorBody(code: string, message: string): string {
  // The exact shape apps/kira-studio/internal/bridge/transport_http.go's httpError writes for a bound
  // method's error (P57 §1.6/D5): `.message` is ipcerr.Error's own JSON encoding, `.cause` is
  // that same {code, message} as a real object. control.ts's `unwrap` reads `.cause` first, so a
  // fixture miss surfaces as a diagnosable `E_FIXTURE_MISS`, not a raw network failure.
  return JSON.stringify({
    kind: 'RuntimeError',
    message: JSON.stringify({ code, message }),
    cause: { code, message },
  });
}

export interface ControlLogEntry {
  channel: string;
  args: unknown;
}

export interface ControlMockHandle {
  /** Every Call this mock actually answered, in order (P50 D7's capability, ported). */
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
 * Replaces the control channel's answers at the network layer (P57 D13) — `page.route`
 * intercepts every request under `/wails/`: the real runtime bundle itself (served for real, off
 * disk — see `serveWailsRuntimeJs` above) and the one RPC endpoint bound calls POST to. Unlike the
 * pre-P57 `tests/ipc/support/mockControl.ts` (which sat behind a real
 * `contextBridge`/`ipcRenderer.invoke` inside an Electron main process), this sits behind nothing
 * — the mocked HTTP response is exactly what `unwrap`/`trust` in `bridge/control.ts` are written
 * to consume, so a frontend spec still exercises that code for real.
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
  // Two or more snapshots can share one (channel, args) key on purpose — mirrors
  // tests/ipc/support/mockControl.ts's own comment and reasoning verbatim.
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
    // page load, unconditionally, to decide whether to inject a user-provided custom.js. A 404
    // (what a real Wails backend answers when none exists) is a legitimate HTTP outcome the app
    // itself handles via a `.catch(() => {})` — but Chromium's own devtools console logs *any*
    // non-2xx response as a "Failed to load resource" error line regardless of whether the page's
    // own JS ever sees or handles it, which would otherwise show up in every single spec's
    // `consoleErrors` collection for a probe no spec asked for and no spec's `channel` fixture
    // covers. Answering 200 with a non-JavaScript content type is what a real Wails backend's own
    // custom-asset-not-configured path would look like at the HTTP level too: `n.ok` is true, so
    // no console error, but `loadOptionalScript`'s own content-type check fails, so no script is
    // injected either — the same no-op outcome as a 404, with none of the console noise.
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
    // A channel called with the same args every time (connectionsList, connectionsStates) has
    // exactly one snapshot and answers regardless of the exact args it was called with — e.g.
    // opsCancel's opId is generated client-side per run and can never appear in a captured
    // fixture (mirrors mockControl.ts's own single-snapshot shortcut).
    function findSnap(args: unknown): ControlSnapshot | undefined {
      if (!grouped) return undefined;
      const key = canonical(args);
      const group = grouped.get(key);
      if (!group) return undefined;
      const at = cursors.get(`${channel}:${key}`) ?? 0;
      cursors.set(`${channel}:${key}`, at + 1);
      return group[Math.min(at, group.length - 1)];
    }
    function findSnapWithRefreshFallback(args: unknown): ControlSnapshot | undefined {
      const direct = findSnap(args);
      if (direct) return direct;
      // P57 finding: `refresh:true` never appears in a captured fixture (D15/D5's own write-mode
      // capture always reads `refresh:false` first, the same discipline
      // tests/ipc/support/harness.ts's own cache-aside stand-in follows) — a real Wails backend
      // still answers it with the same data a `refresh:false` read would, since nothing in a
      // static fixture's world ever actually changes between the two. Falling back to the
      // `refresh:false` entry for the same otherwise-identical args is what a real server does in
      // this case, not a shortcut around a missing capture.
      if (args && typeof args === 'object' && (args as { refresh?: unknown }).refresh === true) {
        return findSnap({ ...args, refresh: false });
      }
      return undefined;
    }
    const snap = list.length === 1 ? list[0] : findSnapWithRefreshFallback(callArgs);
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
        body: runtimeErrorBody(snap.error.code, snap.error.message),
      });
      return;
    }
    // `response: undefined` (a void-returning channel, e.g. opsCancel) round-trips through
    // JSON.stringify as a dropped key — `JSON.stringify(undefined)` is itself `undefined`, not the
    // string `"undefined"`, so it is special-cased to the JSON literal `null`, exactly what a Go
    // method returning no value marshals to.
    const responseBody = snap.response === undefined ? 'null' : JSON.stringify(snap.response);
    await route.fulfill({ status: 200, contentType: 'application/json', body: responseBody });
  });

  return { log: () => log };
}
