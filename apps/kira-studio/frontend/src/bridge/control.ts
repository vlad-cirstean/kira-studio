import * as AppService from '@bindings/appservice.js';
import * as ConnectionsService from '@bindings/connectionsservice.js';
import * as EngineService from '@bindings/engineservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as FiltersService from '@bindings/filtersservice.js';
import * as HttpService from '@bindings/httpservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import type * as WailsModels from '@bindings/models.js';
import * as OpsService from '@bindings/opsservice.js';
import * as QueriesService from '@bindings/queriesservice.js';
import * as SchemaService from '@bindings/schemaservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TreeService from '@bindings/treeservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { ObjectDefinition } from '@shared/domain/definition';
import type { HttpHeaderWire, HttpResponseWire } from '@shared/domain/http';
import type { Layout, LayoutPatch } from '@shared/domain/layout';
import type { OpRecord } from '@shared/domain/ops';
import type {
  ConsoleBody,
  FilterBody,
  FilterHistoryEntry,
  SavedConsoleQuery,
  SavedFilterQuery,
  SavedQuery,
  SortSpec,
} from '@shared/domain/queries';
import type { ConnectionDdl } from '@shared/domain/schema';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord } from '@shared/domain/tabs';
import type { ObjectMeta, TreeNode } from '@shared/domain/tree';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import { type AppMetricsSample, CHANNEL } from '@shared/protocol/events';
// See bridge/port.ts's identical import for why this needs the directive below rather than the
// require-an-error kind (P57 M1/M2 finding: a tsconfig "paths" entry for this exact specifier
// breaks Bun's mock.module interception).
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see comment above)
// @ts-ignore
import { Events } from '/wails/runtime.js';
import { windowKey } from '../state/window';

// P57 D5. Wails delivers a bound method's error as a RuntimeError whose .message is
// ipcerr.Error's own JSON encoding and whose .cause is that same {code, message} as an object
// (apps/kira-studio/internal/bridge's ipcerr package + Wails' bindings.go/transport_http.go). Unwrapped once,
// here, so every consumer keeps reading `err.message` for display and `err.code` for branching.
export function unwrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    const e = err as { message?: string; cause?: unknown };
    const cause = e.cause as { code?: unknown; message?: unknown } | undefined;
    let code = 'E_INTERNAL';
    let message = e.message ?? String(err);
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
      code = cause.code;
      message = typeof cause.message === 'string' ? cause.message : message;
    } else {
      // Belt and braces: a Wails change that stops populating `cause` still leaves the same JSON
      // in `.message`, because ipcerr.Error.Error() is what CallError.Message is built from.
      try {
        const parsed = JSON.parse(message) as { code?: unknown; message?: unknown };
        if (typeof parsed.code === 'string') {
          code = parsed.code;
          if (typeof parsed.message === 'string') message = parsed.message;
        }
      } catch {
        // not our JSON — E_INTERNAL with the raw text is the right answer
      }
    }
    const out: Error & { code?: string } = new Error(message);
    out.code = code;
    throw out;
  });
}

function on<T>(name: string, cb: (payload: T) => void): () => void {
  return Events.On(name, (ev: { data: T }) => cb(ev.data));
}

// The generated bindings type array-returning methods as `T[] | null` (a Go nil slice marshals to
// `null`), even though every backing repo/service in this codebase builds an explicit `[]T{}` or
// `make([]T, 0, ...)` and never actually returns nil for these. Every `r ?? []` below keeps
// control.ts's own return types exactly as they were pre-P57 (plain arrays, never null) rather
// than pushing that generator conservatism onto every caller.
//
// The generated bindings also type every Go enum-like field (ConnectionSummary.kind,
// ConnectionState.status, SecretStorageStatus.backend, TreeVisibility's hiddenKinds, SavedQuery's
// kind/body, OpRecord.kind, TabRecord.kind, TreeNode.kind, ObjectMeta/ObjectDefinition.kind…) as
// plain `string`, since Go's own enum-like types don't carry a literal-union guarantee across the
// wire the way a Zod schema does. The Go value is always one of the valid members — the same
// trust boundary window.kira's Electron IPC handlers implicitly had — so `trust` is a deliberate,
// documented widen-then-narrow, not a silent bypass of a real check.
function trust<T>(v: unknown): T {
  return v as T;
}

export const control = {
  appInfo: (): Promise<WailsModels.AppInfo> => unwrap(AppService.Info()),
  settingsGetAll: (): Promise<Settings> =>
    unwrap(SettingsService.GetAll()).then((r) => trust<Settings>(r)),
  settingsSet: (patch: SettingsPatch): Promise<Settings> =>
    unwrap(SettingsService.Set({ patch })).then((r) => trust<Settings>(r)),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) =>
    on(CHANNEL.settingsChanged, cb),
  layoutGetAll: (): Promise<Layout> => unwrap(LayoutService.GetAll()).then((r) => trust<Layout>(r)),
  layoutSet: (patch: LayoutPatch): Promise<Layout> =>
    unwrap(LayoutService.Set({ patch })).then((r) => trust<Layout>(r)),
  onLayoutChanged: (cb: (layout: Layout) => void): (() => void) => on(CHANNEL.layoutChanged, cb),
  engineStatus: (): Promise<WailsModels.EngineStatus> => unwrap(EngineService.Status()),
  onOpenSettings: (cb: () => void): (() => void) => on(CHANNEL.openSettings, cb),
  onNewConnection: (cb: () => void): (() => void) => on(CHANNEL.newConnection, cb),
  onToggleProjectPanel: (cb: () => void): (() => void) => on(CHANNEL.toggleProjectPanel, cb),
  onToggleOperationsPanel: (cb: () => void): (() => void) => on(CHANNEL.toggleOperationsPanel, cb),
  onCommandPalette: (cb: () => void): (() => void) => on(CHANNEL.commandPalette, cb),
  onTabNext: (cb: () => void): (() => void) => on(CHANNEL.tabNext, cb),
  onTabPrev: (cb: () => void): (() => void) => on(CHANNEL.tabPrev, cb),
  onTabClose: (cb: () => void): (() => void) => on(CHANNEL.tabClose, cb),
  onViewFind: (cb: () => void): (() => void) => on(CHANNEL.viewFind, cb),
  onViewRefresh: (cb: () => void): (() => void) => on(CHANNEL.viewRefresh, cb),
  onViewRun: (cb: () => void): (() => void) => on(CHANNEL.viewRun, cb),
  onViewRunAll: (cb: () => void): (() => void) => on(CHANNEL.viewRunAll, cb),
  onViewFormat: (cb: () => void): (() => void) => on(CHANNEL.viewFormat, cb),
  // Quit handshake: main holds `before-quit` until every window acks this (P8 C8: every window,
  // not just the first to ack), so a debounced save still pending when the user quits is never
  // silently lost.
  onFlushBeforeClose: (cb: () => void): (() => void) => on(CHANNEL.appFlushBeforeClose, cb),
  appFlushed: (): void => {
    void LifecycleService.Flushed({ windowKey });
  },
  // Close-window handshake (P8 C6/F8): the single-window analogue of the quit handshake above —
  // this window's own close is held until it acks, or a 2s timeout on the Go side gives up.
  onWindowFlushBeforeClose: (cb: () => void): (() => void) =>
    on(CHANNEL.windowFlushBeforeClose, cb),
  windowFlushed: (): void => {
    void LifecycleService.WindowFlushed({ windowKey });
  },

  filesChooseSave: (defaultName: string): Promise<WailsModels.FilesChooseSaveResult> =>
    unwrap(FilesService.ChooseSave({ defaultName })),
  filesChooseOpen: (
    args?: WailsModels.FilesChooseOpenArgs,
  ): Promise<WailsModels.FilesChooseOpenResult> => unwrap(FilesService.ChooseOpen(args ?? {})),

  connectionsList: (): Promise<ConnectionSummary[]> =>
    unwrap(ConnectionsService.List()).then((r) => trust<ConnectionSummary[]>(r ?? [])),
  connectionsCreate: (input: ConnectionInput): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Create(input)).then((r) => trust<ConnectionSummary>(r)),
  connectionsUpdate: (id: string, input: ConnectionInput): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Update({ id, input })).then((r) => trust<ConnectionSummary>(r)),
  connectionsDuplicate: (id: string): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Duplicate({ id })).then((r) => trust<ConnectionSummary>(r)),
  // Go-side name is Remove, not Delete (P57 §1.9) — read the .go file, do not assume lowerCamel.
  connectionsDelete: (id: string): Promise<void> => unwrap(ConnectionsService.Remove({ id })),
  connectionsReorder: (ids: string[]): Promise<ConnectionSummary[]> =>
    unwrap(ConnectionsService.Reorder({ ids })).then((r) => trust<ConnectionSummary[]>(r ?? [])),
  // P14 D6: outcome is one of revealed | cancelled | confirmation-required | error — confirmed is
  // honoured by the backend only on the confirmation-required path (a Mac where LocalAuthentication
  // works ignores it entirely).
  connectionsReveal: (
    id: string,
    confirmed: boolean,
  ): Promise<{ password: string | null; error: string | null; outcome: string }> =>
    unwrap(ConnectionsService.Reveal({ id, confirmed })),
  // The generated TestResult's serverVersion/error are `string | null | undefined`; the pre-P57
  // shape was `string | undefined` only (no null) — normalized here rather than pushed onto
  // ConnectionDialog.vue, which assigns straight into its own `?: string` reactive state.
  // P14 D3: id is the dialog's editingId (empty for a brand-new connection) — the backend fills in
  // the stored secret server-side when the draft carries none, so Test on an existing connection
  // whose password field was never revealed still probes with the real credential.
  connectionsTest: (
    input: ConnectionInput,
    id: string,
  ): Promise<{
    ok: boolean;
    serverVersion?: string;
    error?: string;
  }> =>
    unwrap<Awaited<ReturnType<typeof ConnectionsService.Test>>>(
      ConnectionsService.Test({ input, id }),
    ).then((r) => ({
      ok: r.ok,
      serverVersion: r.serverVersion ?? undefined,
      error: r.error ?? undefined,
    })),
  connectionsConnect: (id: string): Promise<ConnectionState> =>
    unwrap(ConnectionsService.Connect({ id })).then((r) => trust<ConnectionState>(r)),
  connectionsDisconnect: (id: string): Promise<ConnectionState> =>
    unwrap(ConnectionsService.Disconnect({ id })).then((r) => trust<ConnectionState>(r)),
  connectionsStates: (): Promise<ConnectionState[]> =>
    unwrap(ConnectionsService.States()).then((r) => trust<ConnectionState[]>(r ?? [])),
  connectionsSecretsStatus: (): Promise<SecretStorageStatus> =>
    unwrap(ConnectionsService.SecretsStatus()).then((r) => trust<SecretStorageStatus>(r)),
  onConnectionState: (cb: (state: ConnectionState) => void): (() => void) =>
    on(CHANNEL.connectionState, cb),
  onConnectionMetadataInvalidated: (cb: (connectionId: string) => void): (() => void) =>
    on(CHANNEL.connectionMetadataInvalidated, cb),
  onConnectionsChanged: (cb: (records: ConnectionSummary[]) => void): (() => void) =>
    on(CHANNEL.connectionsChanged, cb),

  treeChildren: (
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ nodes: TreeNode[]; source: 'cache' | 'server'; truncated: boolean }> =>
    unwrap<Awaited<ReturnType<typeof TreeService.Children>>>(
      TreeService.Children({ connectionId, path, refresh: refresh ?? false }),
    ).then((r) =>
      trust<{ nodes: TreeNode[]; source: 'cache' | 'server'; truncated: boolean }>({
        ...r,
        nodes: r.nodes ?? [],
      }),
    ),
  treeDescribe: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<{ meta: ObjectMeta; source: 'cache' | 'server' }> =>
    unwrap(
      TreeService.Describe({
        connectionId,
        path,
        refresh: refresh ?? false,
        tabId: tabId ?? null,
      }),
    ).then((r) => trust<{ meta: ObjectMeta; source: 'cache' | 'server' }>(r)),
  treeDefinition: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<{ definition: ObjectDefinition; source: 'cache' | 'server' }> =>
    unwrap(
      TreeService.Definition({
        connectionId,
        path,
        refresh: refresh ?? false,
        tabId: tabId ?? null,
      }),
    ).then((r) => trust<{ definition: ObjectDefinition; source: 'cache' | 'server' }>(r)),
  treeInvalidate: (connectionId: string, path?: string): Promise<void> =>
    unwrap(TreeService.Invalidate({ connectionId, path: path ?? null })),

  filtersList: (connectionId: string): Promise<TreeVisibility> =>
    unwrap(FiltersService.List({ connectionId })).then((r) => trust<TreeVisibility>(r)),
  filtersReplace: (connectionId: string, visibility: TreeVisibility): Promise<TreeVisibility> =>
    unwrap(FiltersService.Replace({ connectionId, visibility })).then((r) =>
      trust<TreeVisibility>(r),
    ),

  opsRecent: (limit: number): Promise<OpRecord[]> =>
    unwrap(OpsService.Recent({ limit })).then((r) => trust<OpRecord[]>(r ?? [])),
  opsCancel: (opId: string): Promise<void> => unwrap(OpsService.Cancel({ opId })),
  onOpUpdate: (cb: (record: OpRecord) => void): (() => void) => on(CHANNEL.opUpdate, cb),

  // P2 D3: runs through the same op scheduler/op log the DB adapters use (opId is
  // renderer-minted, exactly like every data-plane op's own beginOp) — never the webview's own
  // fetch (docs/ARCHITECTURE.md's "Go owns the network"). The generated Send drops the injected
  // ctx parameter from its TS signature (§6.1) — Wails still passes it through server-side, so a
  // window closing mid-request still aborts it.
  httpSend: (args: {
    opId: string;
    tabId: string;
    method: string;
    url: string;
    headers: HttpHeaderWire[];
    body: string;
    hasBody: boolean;
  }): Promise<HttpResponseWire> =>
    unwrap(HttpService.Send(args)).then((r) => trust<HttpResponseWire>(r)),

  onAppMetrics: (cb: (sample: AppMetricsSample) => void): (() => void) =>
    on(CHANNEL.appMetrics, cb),

  // windowsEnsure registers this page's own windowKey with a `windows` row if it doesn't already
  // have one — always a no-op on the native shell (main.go's own window-creation paths already
  // created it before this page's URL ever loaded, D2), and the only thing that ever does on a
  // `-tags server` build, which has no shell managing window creation at all. bootstrap() in
  // main.ts awaits this before hydrateTabs() (or anything else window-scoped) runs.
  windowsEnsure: (): Promise<void> => unwrap(WindowsService.Ensure({ windowKey })),

  // Both scoped to this page's own workbench (P8 D2/F6) — windowKey is read once, synchronously,
  // at module load (state/window.ts), before hydrateTabs() ever calls tabsList().
  tabsList: (): Promise<TabRecord[]> =>
    unwrap(TabsService.List({ windowKey })).then((r) => trust<TabRecord[]>(r ?? [])),
  tabsSave: (tabs: TabRecord[]): Promise<void> => unwrap(TabsService.Save({ windowKey, tabs })),

  // Go's SavedQuery is one flat struct with `kind: string` and `body: json.RawMessage` (typed
  // `any` in the bindings) rather than the domain's real discriminated union — Go has no sum
  // types, so the polymorphic body is opaque JSON on the wire and the discriminant is a plain
  // string. `trust` narrows both at once, on the same "the server always writes a valid shape"
  // assumption the Electron build made implicitly.
  queriesList: (connectionId: string, path: string): Promise<SavedFilterQuery[]> =>
    unwrap(QueriesService.List({ connectionId, path })).then((r) =>
      trust<SavedFilterQuery[]>(r ?? []),
    ),
  queriesSave: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }): Promise<SavedFilterQuery> =>
    unwrap(QueriesService.Save(args)).then((r) => trust<SavedFilterQuery>(r)),
  queriesListConsole: (connectionId: string, path: string): Promise<SavedConsoleQuery[]> =>
    unwrap(QueriesService.ListConsole({ connectionId, path })).then((r) =>
      trust<SavedConsoleQuery[]>(r ?? []),
    ),
  queriesSaveConsole: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: ConsoleBody;
    pinned: boolean;
  }): Promise<SavedConsoleQuery> =>
    unwrap(QueriesService.SaveConsole(args)).then((r) => trust<SavedConsoleQuery>(r)),
  queriesUpdate: (id: string, patch: { name?: string; pinned?: boolean }): Promise<SavedQuery> =>
    unwrap(
      QueriesService.Update({ id, name: patch.name ?? null, pinned: patch.pinned ?? null }),
    ).then((r) => trust<SavedQuery>(r)),
  queriesDelete: (id: string): Promise<void> => unwrap(QueriesService.Delete({ id })),
  queriesTouch: (id: string): Promise<void> => unwrap(QueriesService.Touch({ id })),
  queriesHistoryList: (
    connectionId: string,
    path: string,
    limit: number,
  ): Promise<FilterHistoryEntry[]> =>
    unwrap(QueriesService.HistoryList({ connectionId, path, limit })).then((r) =>
      trust<FilterHistoryEntry[]>(r ?? []),
    ),
  queriesHistoryRecord: (
    connectionId: string,
    path: string,
    where: string | null,
    orderBy: SortSpec | null,
  ): Promise<void> => unwrap(QueriesService.HistoryRecord({ connectionId, path, where, orderBy })),

  schemaGet: (connectionId: string): Promise<ConnectionDdl> =>
    unwrap(SchemaService.Get({ connectionId })).then((r) => trust<ConnectionDdl>(r)),
  schemaSet: (connectionId: string, ddl: string): Promise<ConnectionDdl> =>
    unwrap(SchemaService.Set({ connectionId, ddl })).then((r) => trust<ConnectionDdl>(r)),
  onSchemaChanged: (cb: (ddl: ConnectionDdl) => void): (() => void) =>
    on(CHANNEL.schemaChanged, cb),
};
