import * as AppService from '@bindings/appservice.js';
import * as CollectionsService from '@bindings/collectionsservice.js';
import * as ConnectionsService from '@bindings/connectionsservice.js';
import * as EngineService from '@bindings/engineservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as FiltersService from '@bindings/filtersservice.js';
import * as GrpcService from '@bindings/grpcservice.js';
import * as HttpService from '@bindings/httpservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import type * as WailsModels from '@bindings/models.js';
import * as OpsService from '@bindings/opsservice.js';
import * as QueriesService from '@bindings/queriesservice.js';
import * as ResponseHistoryService from '@bindings/responsehistoryservice.js';
import * as SchemaService from '@bindings/schemaservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TreeService from '@bindings/treeservice.js';
import * as VariablesService from '@bindings/variablesservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
// P4: model.SavedRequest is a storage-package type, not a bridge one — CollectionsService's own
// args/results reference it rather than restating it, so the renderer types against it through
// vite.config.ts's existing (until now unused) @bindings-internal alias.
import type * as WailsStorageModels from '@bindings-internal/storage/model/models.js';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { ObjectDefinition } from '@shared/domain/definition';
import type {
  GrpcCallEvent,
  GrpcCallResultWire,
  GrpcMetaPairWire,
  GrpcSchemaWire,
} from '@shared/domain/grpc';
import type { HttpBodyWire, HttpHeaderWire, HttpResponseWire } from '@shared/domain/http';
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
import type {
  ResponseHistoryEntry,
  ResponseHistorySnapshot,
} from '@shared/domain/response-history';
import type { ConnectionDdl } from '@shared/domain/schema';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord } from '@shared/domain/tabs';
import type { ObjectMeta, TreeNode } from '@shared/domain/tree';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import type {
  HttpEnvironment,
  HttpVariable,
  HttpVariableHistoryEntry,
  RevealResult,
  VariableScope,
} from '@shared/domain/variables';
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
// P10 D15: `details` — ipcerr.Error's own optional `json.RawMessage` field — is carried through
// the same way, parsed once here rather than pushed onto every consumer; `undefined` for every
// existing producer, which leaves the field unset (`omitempty`).
export function unwrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    const e = err as { message?: string; cause?: unknown };
    const cause = e.cause as { code?: unknown; message?: unknown; details?: unknown } | undefined;
    let code = 'E_INTERNAL';
    let message = e.message ?? String(err);
    let details: unknown;
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
      code = cause.code;
      message = typeof cause.message === 'string' ? cause.message : message;
      details = cause.details;
    } else {
      // Belt and braces: a Wails change that stops populating `cause` still leaves the same JSON
      // in `.message`, because ipcerr.Error.Error() is what CallError.Message is built from.
      try {
        const parsed = JSON.parse(message) as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
        };
        if (typeof parsed.code === 'string') {
          code = parsed.code;
          if (typeof parsed.message === 'string') message = parsed.message;
          details = parsed.details;
        }
      } catch {
        // not our JSON — E_INTERNAL with the raw text is the right answer
      }
    }
    const out: Error & { code?: string; details?: unknown } = new Error(message);
    out.code = code;
    out.details = details;
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

// model.VariableScope is a named Go string type (unlike, say, model.CollectionItem.Kind, which is
// a plain `string`), so the generator emits a real TS `enum` for it — a plain 'collection' |
// 'environment' literal is not structurally assignable to that nominal type. The same documented
// widen-then-narrow `trust` already applies to every bound *result*; this is its one *argument*-
// side counterpart, needed only because this is the one bound call whose input carries a Go named
// enum type at all.
function scopeArg(scope: VariableScope): WailsStorageModels.VariableScope {
  return scope as unknown as WailsStorageModels.VariableScope;
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
  // window closing mid-request still aborts it. P5 D6: collectionId/environmentId name the scope
  // stage 2 (Go) resolves secrets against — both '' is valid (a scratch tab, no environment).
  // P8 D2: itemId travels alongside so Go can record a response-history entry under the right
  // scope — '' for a scratch tab, exactly like collectionId/environmentId's own "possibly empty"
  // shape above. Optional here (C3): a missing field decodes as Go's zero value ("") on the wire,
  // and state.ts's send() only starts actually passing it in C4.
  httpSend: (args: {
    opId: string;
    tabId: string;
    method: string;
    url: string;
    headers: HttpHeaderWire[];
    body: HttpBodyWire;
    collectionId: string;
    environmentId: string;
    itemId?: string;
  }): Promise<HttpResponseWire> =>
    unwrap(HttpService.Send({ ...args, itemId: args.itemId ?? '' })).then((r) =>
      trust<HttpResponseWire>(r),
    ),

  onAppMetrics: (cb: (sample: AppMetricsSample) => void): (() => void) =>
    on(CHANNEL.appMetrics, cb),

  // P11 D3/D4: resolves a target's (or a .proto's) services and methods — reflection.Register's
  // own cache lives in Go (grpcclient's descriptorCache), never here; `reload` bypasses it (the
  // schema pane's own Reload button).
  grpcDescribe: (args: {
    descriptorMode: 'reflection' | 'proto';
    target: string;
    tls: { enabled: boolean; caFile: string; serverName: string };
    metadata: GrpcMetaPairWire[];
    protoPath: string;
    importPaths: string[];
    collectionId: string;
    environmentId: string;
    reload: boolean;
  }): Promise<GrpcSchemaWire> =>
    unwrap(GrpcService.Describe(args)).then((r) => trust<GrpcSchemaWire>(r)),

  // P11 D7/D8: runs through the same op scheduler/op log HttpService.Send already does (opId
  // renderer-minted, tabId/windowKey addressing exactly like httpSend/TabsService's own shape).
  // `streaming` tells Go which of Unary/ServerStream to run — the renderer already knows this
  // from the schema it resolved via grpcDescribe.
  grpcCall: (args: {
    opId: string;
    tabId: string;
    streaming: boolean;
    descriptorMode: 'reflection' | 'proto';
    target: string;
    tls: { enabled: boolean; caFile: string; serverName: string };
    protoPath: string;
    importPaths: string[];
    service: string;
    method: string;
    messageJson: string;
    metadata: GrpcMetaPairWire[];
    collectionId: string;
    environmentId: string;
    itemId?: string;
  }): Promise<GrpcCallResultWire> =>
    unwrap(GrpcService.Call({ ...args, windowKey, itemId: args.itemId ?? '' })).then((r) =>
      trust<GrpcCallResultWire>(r),
    ),

  // P11 D8: one server-streaming call's coalesced message batches — EmitTo'd to this window only,
  // so a stream in one window never wakes another.
  onGrpcCall: (cb: (event: GrpcCallEvent) => void): (() => void) => on(CHANNEL.grpcCall, cb),

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

  // P4 D11: nine wrappers over CollectionsService. These stay typed against the generated models
  // rather than `trust<T>()`-ing a domain type, because the one place a saved request's shape
  // genuinely has to be trusted is where it becomes tab state — `openCollectionRequestTab` Zod-
  // parses it there (D4), which is the app's single trust boundary for this document rather than
  // a second one here. Only a *path* ever crosses this bridge for import/export, never a file's
  // bytes (D11/F16): Go reads and Go writes.
  collectionsList: (): Promise<{
    collections: WailsModels.CollectionSummary[];
    items: WailsModels.ItemSummary[];
  }> =>
    // The explicit type argument is `connectionsTest`'s own precedent above: tests/unit's
    // tsconfig resolves the generated $CancellablePromise loosely, so a `.then` that reads members
    // off the result (rather than handing it straight to `trust`) needs the awaited type named.
    unwrap<WailsModels.CollectionsTree>(CollectionsService.List()).then((r) => ({
      collections: r.collections ?? [],
      items: r.items ?? [],
    })),
  collectionsGetRequest: (itemId: string): Promise<WailsStorageModels.SavedRequest> =>
    unwrap(CollectionsService.GetRequest({ itemId })),
  collectionsSaveRequest: (
    itemId: string,
    name: string,
    request: WailsStorageModels.SavedRequest,
  ): Promise<WailsModels.ItemSummary> =>
    unwrap(CollectionsService.SaveRequest({ itemId, name, request })),
  collectionsCreateCollection: (name: string): Promise<WailsModels.CollectionSummary> =>
    unwrap(CollectionsService.CreateCollection({ name })),
  collectionsCreateItem: (args: {
    collectionId: string;
    parentId: string | null;
    kind: 'folder' | 'request';
    request?: WailsStorageModels.SavedRequest | null;
    name: string;
  }): Promise<WailsModels.ItemSummary> =>
    unwrap(CollectionsService.CreateItem({ ...args, request: args.request ?? null })),
  collectionsRename: (id: string, target: 'collection' | 'item', name: string): Promise<void> =>
    unwrap(CollectionsService.Rename({ id, target, name })),
  collectionsDelete: (id: string, target: 'collection' | 'item'): Promise<void> =>
    unwrap(CollectionsService.Delete({ id, target })),
  collectionsImport: (path: string): Promise<WailsModels.ImportReport> =>
    unwrap(CollectionsService.Import({ path })),
  // P5 D16: ExportReport.secretCount is what lets the panel say "N secret values were not
  // written" once, rather than that being a fact only discoverable by opening the file.
  collectionsExport: (collectionId: string, path: string): Promise<WailsModels.ExportReport> =>
    unwrap(CollectionsService.Export({ collectionId, path })),

  // P5 D19: thirteen wrappers over VariablesService — typed against the shared domain mirrors
  // (D20) rather than the generated models directly, the one difference from collectionsList's
  // own precedent above (nothing here becomes tab state, so there is no equivalent reason to stay
  // close to the wire shape).
  variablesListEnvironments: (): Promise<HttpEnvironment[]> =>
    unwrap(VariablesService.ListEnvironments()).then((r) => trust<HttpEnvironment[]>(r ?? [])),
  variablesCreateEnvironment: (name: string): Promise<HttpEnvironment> =>
    unwrap(VariablesService.CreateEnvironment({ name })).then((r) => trust<HttpEnvironment>(r)),
  variablesRenameEnvironment: (id: string, name: string): Promise<void> =>
    unwrap(VariablesService.RenameEnvironment({ id, name })),
  variablesDeleteEnvironment: (id: string): Promise<void> =>
    unwrap(VariablesService.DeleteEnvironment({ id })),
  // id: '' selects "No environment" (D3).
  variablesSetActiveEnvironment: (id: string): Promise<void> =>
    unwrap(VariablesService.SetActiveEnvironment({ id })),
  variablesReorderEnvironments: (ids: string[]): Promise<void> =>
    unwrap(VariablesService.ReorderEnvironments({ ids })),

  variablesList: (scope: VariableScope, ownerId: string): Promise<HttpVariable[]> =>
    unwrap(VariablesService.List({ scope: scopeArg(scope), ownerId })).then((r) =>
      trust<HttpVariable[]>(r ?? []),
    ),
  // id: '' creates a new row (D19).
  variablesUpsert: (args: {
    scope: VariableScope;
    ownerId: string;
    id: string;
    name: string;
    value: string;
    isSecret: boolean;
  }): Promise<HttpVariable> =>
    unwrap(VariablesService.Upsert({ ...args, scope: scopeArg(args.scope) })).then((r) =>
      trust<HttpVariable>(r),
    ),
  variablesDelete: (id: string): Promise<void> => unwrap(VariablesService.Delete({ id })),
  variablesReorder: (scope: VariableScope, ownerId: string, ids: string[]): Promise<void> =>
    unwrap(VariablesService.Reorder({ scope: scopeArg(scope), ownerId, ids })),

  variablesHistory: (variableId: string): Promise<HttpVariableHistoryEntry[]> =>
    unwrap(VariablesService.History({ variableId })).then((r) =>
      trust<HttpVariableHistoryEntry[]>(r ?? []),
    ),

  // D8/D9: neither reveal call ever rejects — the outcome names what happened (revealed |
  // cancelled | confirmation-required | error), the same contract connectionsReveal already has.
  variablesReveal: (variableId: string, confirmed: boolean): Promise<RevealResult> =>
    unwrap(VariablesService.Reveal({ variableId, confirmed })).then((r) => trust<RevealResult>(r)),
  variablesRevealHistory: (historyId: string, confirmed: boolean): Promise<RevealResult> =>
    unwrap(VariablesService.RevealHistory({ historyId, confirmed })).then((r) =>
      trust<RevealResult>(r),
    ),

  // P8 D8: five wrappers over ResponseHistoryService. List/Clear take both ids — '' for whichever
  // doesn't apply — and the service computes the scope key the same way the generated SQLite
  // column does, so the two sides can never disagree about what a scope is.
  historyList: (itemId: string, tabId: string): Promise<ResponseHistoryEntry[]> =>
    unwrap(ResponseHistoryService.List({ itemId, tabId })).then((r) =>
      trust<ResponseHistoryEntry[]>(r ?? []),
    ),
  historyGet: (id: string): Promise<ResponseHistorySnapshot> =>
    unwrap(ResponseHistoryService.Get({ id })).then((r) => trust<ResponseHistorySnapshot>(r)),
  historyDelete: (id: string): Promise<void> => unwrap(ResponseHistoryService.Delete({ id })),
  historyClear: (itemId: string, tabId: string): Promise<void> =>
    unwrap(ResponseHistoryService.Clear({ itemId, tabId })),
  // D14: called from http/state/collections.ts's Save-as path, immediately after the CreateItem
  // that produced itemId.
  historyAdopt: (tabId: string, itemId: string): Promise<number> =>
    // Explicit type argument: tests/unit's tsconfig resolves the generated $CancellablePromise
    // loosely, same as collectionsList above — a `.then` that reads a member off the result needs
    // the awaited type named rather than handed straight to `trust`.
    unwrap<WailsModels.ResponseHistoryAdoptResult>(
      ResponseHistoryService.Adopt({ tabId, itemId }),
    ).then((r) => r.adopted),
};
