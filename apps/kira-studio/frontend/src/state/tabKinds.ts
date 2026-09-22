import { hasRequestBody, httpRequestTitle } from '@kira/api-core';
import type { ConnectionColor } from '@shared/domain/connection';
import {
  defaultGrpcRequestTabState,
  type GrpcRequestTabState,
  grpcRequestTabStateSchema,
  grpcRequestTitle,
} from '@shared/domain/grpc';
import {
  defaultHttpRequestTabState,
  type HttpRequestTabState,
  httpRequestTabStateSchema,
} from '@shared/domain/http';
import {
  type BrowseTabRecord,
  type BrowseTabState,
  browseTabStateSchema,
  type ConsoleTabRecord,
  type ConsoleTabState,
  consoleTabStateSchema,
  type DataTabRecord,
  type DataTabState,
  type DefinitionTabRecord,
  type DefinitionTabState,
  type DocumentTabRecord,
  type DocumentTabState,
  dataTabStateSchema,
  defaultBrowseTabState,
  defaultConsoleTabState,
  defaultDataTabState,
  defaultDefinitionTabState,
  defaultDocumentTabState,
  defaultKeyValueTabState,
  defaultStreamTabState,
  definitionTabStateSchema,
  documentTabStateSchema,
  type EnvironmentsTabState,
  environmentsTabStateSchema,
  type GrpcRequestTabRecord,
  type HttpRequestTabRecord,
  type KeyValueTabRecord,
  type KeyValueTabState,
  keyValueTabStateSchema,
  type StreamTabRecord,
  type StreamTabState,
  streamTabStateSchema,
  TAB_KIND_MODE,
  type TabKind,
  type TabRecord,
  type TerminalTabRecord,
  type TerminalTabState,
  tabTitle,
  terminalTabStateSchema,
  type VariableSetTabRecord,
  type VariableSetTabState,
  variableSetTabStateSchema,
} from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import type { MenuItem } from '@workbench/state/contextMenu';
import { useTreeStore } from '../project/state/tree';
import { dropForTab as dropConsoleResultPagesForTab } from '../views/console/resultPages';
import { drop as dropDocumentPagesForTab } from '../views/documents/page';
import { drop as dropGridPagesForTab } from '../views/grid/page';
import { drop as dropKeyValuePagesForTab } from '../views/shared/keyvalue/page';
import { drop as dropStreamPagesForTab } from '../views/stream/page';
import { useConnectionsStore } from './connections';
import { useSettingsStore } from './settings';
import { useTabIncognitoStore } from './tabIncognito';
import { useTerminalsStore } from './terminals';

// P1 D4/F19: the tab-kind registry, split from workbench/tabViews.ts (C4) by the lint rules —
// this half is component-free (title/icon/railColor/dropResources/menuExtras/state constructors
// only), so it can live in state/ without creating a state/ -> workbench/ edge biome.json forbids
// (F19). Every entry below carries Studio's existing per-kind behaviour verbatim: TabStrip.vue's
// old iconFor body, tabTitle (F10), connectionRecord(tab.connectionId)?.color, and the "Reveal in
// project panel" menu item (F11) — nothing here changes what Studio does, only where it lives.
// P100 Part 2: this used to also allow `{ readonly filePath: string }` (a seti-set file icon,
// `repo/fileIcon.ts`) for 'repo-file' tabs — the one kind that ever returned it. That kind is now
// unreachableTabKind (below), so no TAB_KINDS entry can produce that variant here any more; kept
// as a plain string alias rather than deleted outright, since TabStrip.vue's own `icon(tab)` call
// sites still read through this type name.
type TabIcon = string;

export interface TabKindDef<K extends TabKind = TabKind> {
  mode: (typeof TAB_KIND_MODE)[K];
  title(tab: TabRecord): string;
  icon(tab: TabRecord): TabIcon;
  railColor(tab: TabRecord): ConnectionColor | undefined;
  /** A brand-new tab of this kind, opened with nothing to inherit. */
  defaultState(): Extract<TabRecord, { kind: K }>['state'];
  /** P3 D3: a restored record's raw `state`, normalized through this kind's own schema — the one
   *  place every *TabStateSchema's `.default()` actually fires. `null` means "not parseable", and
   *  the caller (hydrateTabs) keeps what was stored, merge-only, never resetting to defaultState(). */
  parseState(raw: unknown): Extract<TabRecord, { kind: K }>['state'] | null;
  /** §8.4's "same target, fresh default state" — some kinds keep one field from the source
   *  (data/document/keyvalue/stream keep pageSize; the rest start fully blank). */
  duplicateState(tab: Extract<TabRecord, { kind: K }>): Extract<TabRecord, { kind: K }>['state'];
  /** Frees whichever page store this kind populated (a no-op miss for a kind with none). */
  dropResources(tabId: string): void;
  /** Appended to the tab strip's own six generic context-menu items (F11). */
  menuExtras(tab: TabRecord): MenuItem[];
  /** P15 D8: a small state mark after the tab's title — undefined for a kind with nothing to
   *  flag (every kind but 'http-request' today; P4 D15 declined this for `dirty`, a shared "seven
   *  kinds answer false" cost for a cosmetic gain — this member is optional instead, so those
   *  seven kinds grow no line, and answers a question about a tab you're *not* looking at, which
   *  the view's own live dirty mark cannot). */
  badge?(tab: TabRecord): { icon: string; tooltip: string } | null;
  /** C5 §6.1: true for exactly one kind (`repo-graph`) — tabsForWorkspace's own stable partition
   *  (state/mode.ts) puts every pinned tab of a workspace first, and closeTab/closeOthers/
   *  closeToTheRight/closeAll/duplicateTab/moveTab all guard against it (state/tabs.ts). Absent
   *  (not `false`) for every other kind, so this costs those kinds no line. */
  pinned?: true;
}

const KIND_ICON: Record<string, string> = {
  table: 'table',
  view: 'eye',
  matview: 'symbol-structure',
};

function railColor(tab: TabRecord): ConnectionColor | undefined {
  return useConnectionsStore().connectionRecord(tab.connectionId)?.color;
}

// P83 §7.2: a filesystem basename (state.cwd is an absolute path, not an encoded NodePath — this
// is not pathTail).
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// P71 §5.2: both request kinds' own tab context-menu entry — `setIncognito`'s own listener
// (state/tabs.ts) flushes the tab's existing row immediately on the on-transition.
function incognitoMenuExtras(tab: TabRecord): MenuItem[] {
  const tabIncognitoStore = useTabIncognitoStore();
  return [
    {
      type: 'item',
      id: 'incognito',
      label: tabIncognitoStore.isIncognito(tab.id) ? 'Turn off incognito' : 'Incognito',
      icon: 'eye-closed',
      run: () => tabIncognitoStore.setIncognito(tab.id, !tabIncognitoStore.isIncognito(tab.id)),
    },
  ];
}

// Every Studio kind (F11): a tab addresses a tree node, so "Reveal in project panel" makes sense
// for all seven — an Api tab kind (P2+) supplies its own menuExtras instead, or none at all.
function revealInProjectPanel(tab: TabRecord): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'reveal-in-project-panel',
      label: 'Reveal in project panel',
      icon: 'target',
      run: () => {
        if (tab.connectionId) void useTreeStore().revealPath(tab.connectionId, tab.path);
      },
    },
  ];
}

function noDrop(): void {
  // definition/browse have no page store of their own (F12) — nothing to free.
}

// P100 Part 2: a TabKindDef for a kind this app can never actually construct a tab of — see the
// repo-* entries' own comment (below) for why this exists instead of narrowing TAB_KINDS's own key
// type off TabKind. Every member throws if ever actually called (an invariant violation worth
// failing loudly on) except parseState, which returns null like any other unparseable row —
// hydrateTabs' own merge-only contract already handles that safely — and dropResources, a no-op
// like every other kind's own miss case (dropPageStoresForTab blind-calls every registered kind).
function unreachableTabKind<K extends TabKind>(kind: K): TabKindDef<K> {
  const unreachable = (): never => {
    throw new Error(`kira: tab kind "${kind}" belongs to Kira Space, never opened here`);
  };
  return {
    mode: TAB_KIND_MODE[kind],
    title: unreachable,
    icon: unreachable,
    railColor: unreachable,
    defaultState: unreachable,
    parseState: () => null,
    duplicateState: unreachable,
    dropResources: noDrop,
    menuExtras: () => [],
  };
}

// P3 D3: every parseState below is a one-liner over the schema its own kind already imports —
// this is the shared shape (safeParse, `.data` on success, `null` on failure) so each entry states
// only which schema, not the pattern.
function parseStateWith<S>(schema: {
  safeParse(raw: unknown): { success: true; data: S } | { success: false };
}): (raw: unknown) => S | null {
  return (raw) => {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  };
}

export const TAB_KINDS: { [K in TabKind]: TabKindDef<K> } = {
  data: {
    mode: TAB_KIND_MODE.data,
    title: tabTitle,
    icon: (tab) => {
      const tail = pathTail(tab.path);
      return (tail && KIND_ICON[tail.kind]) || 'table';
    },
    railColor,
    defaultState: () => defaultDataTabState(useSettingsStore().data.defaultPageSize),
    duplicateState: (tab: DataTabRecord): DataTabState => defaultDataTabState(tab.state.pageSize),
    dropResources: dropGridPagesForTab,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(dataTabStateSchema),
  },
  definition: {
    mode: TAB_KIND_MODE.definition,
    title: tabTitle,
    icon: () => 'file-code',
    railColor,
    defaultState: () => defaultDefinitionTabState(),
    duplicateState: (_tab: DefinitionTabRecord): DefinitionTabState => defaultDefinitionTabState(),
    dropResources: noDrop,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(definitionTabStateSchema),
  },
  console: {
    mode: TAB_KIND_MODE.console,
    title: tabTitle,
    icon: () => 'terminal',
    railColor,
    defaultState: () => defaultConsoleTabState(),
    duplicateState: (_tab: ConsoleTabRecord): ConsoleTabState => defaultConsoleTabState(),
    dropResources: dropConsoleResultPagesForTab,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(consoleTabStateSchema),
  },
  document: {
    mode: TAB_KIND_MODE.document,
    title: tabTitle,
    icon: () => 'json',
    railColor,
    defaultState: () => defaultDocumentTabState(useSettingsStore().data.defaultPageSize),
    duplicateState: (tab: DocumentTabRecord): DocumentTabState =>
      defaultDocumentTabState(tab.state.pageSize),
    dropResources: dropDocumentPagesForTab,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(documentTabStateSchema),
  },
  keyvalue: {
    mode: TAB_KIND_MODE.keyvalue,
    title: tabTitle,
    // P17: a 'keyvalue' tab is a redis key OR an s3 object — pathTail's own node kind tells
    // them apart with no extra state.
    icon: (tab) => (pathTail(tab.path)?.kind === 'object' ? 'file' : 'symbol-key'),
    railColor,
    defaultState: () => defaultKeyValueTabState(useSettingsStore().data.defaultPageSize),
    duplicateState: (tab: KeyValueTabRecord): KeyValueTabState =>
      defaultKeyValueTabState(tab.state.pageSize),
    dropResources: dropKeyValuePagesForTab,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(keyValueTabStateSchema),
  },
  stream: {
    mode: TAB_KIND_MODE.stream,
    title: tabTitle,
    icon: () => 'broadcast',
    railColor,
    defaultState: () => defaultStreamTabState(useSettingsStore().data.defaultPageSize),
    duplicateState: (tab: StreamTabRecord): StreamTabState =>
      defaultStreamTabState(tab.state.pageSize),
    dropResources: dropStreamPagesForTab,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(streamTabStateSchema),
  },
  browse: {
    mode: TAB_KIND_MODE.browse,
    title: tabTitle,
    icon: () => 'list-tree',
    railColor,
    defaultState: () => defaultBrowseTabState(),
    duplicateState: (_tab: BrowseTabRecord): BrowseTabState => defaultBrowseTabState(),
    dropResources: noDrop,
    menuExtras: revealInProjectPanel,
    parseState: parseStateWith(browseTabStateSchema),
  },
  'http-request': {
    mode: TAB_KIND_MODE['http-request'],
    title: (tab) => httpRequestTitle((tab as HttpRequestTabRecord).state),
    icon: () => 'globe',
    // D2: no connection, so no rail — TabStrip's own rail already resolves undefined to
    // transparent (P1 F17).
    railColor: () => undefined,
    defaultState: () => defaultHttpRequestTabState(),
    // D2: deliberately breaks with every Studio kind's "same target, fresh default state" — an
    // HTTP request's state *is* the request, so duplicating it to try a variant is the only
    // reason anyone would. P3 F10: headers/urlEncoded/formData are deep-copied since each row is
    // an object in an array (a shallow spread would share row objects between the two tabs, so
    // editing one's fields would edit the other's); binaryFile is copied as a fresh object.
    // P4 D14: a duplicated tab is an **unsaved copy** — which is what duplicating a saved request
    // to try a variant means. Clearing both is also what keeps `path` honest (F13): the duplicate
    // carries the original's path, so leaving itemId set would make openTab's reuse lookup
    // activate the copy when the user next opened the original from the tree.
    duplicateState: (tab: HttpRequestTabRecord): HttpRequestTabState => ({
      ...tab.state,
      itemId: null,
      name: '',
      headers: tab.state.headers.map((h) => ({ ...h })),
      urlEncoded: tab.state.urlEncoded.map((f) => ({ ...f })),
      formData: tab.state.formData.map((f) => ({ ...f })),
      binaryFile: tab.state.binaryFile ? { ...tab.state.binaryFile } : null,
    }),
    // D2: the response lives in the view's own runtime store (views/httprequest/state.ts),
    // freed by cleanupTabRuntime — there is no page store of this kind's own to drop.
    dropResources: noDrop,
    // D2: there is no project panel to reveal an HTTP request into. P71 §5.2: the incognito
    // toggle is the one thing this kind appends instead.
    menuExtras: incognitoMenuExtras,
    parseState: parseStateWith(httpRequestTabStateSchema),
    // P15 D8: answers a question about a tab you're not looking at — gRPC is deliberately left
    // out (a call always has a message body, so the mark would be on every tab always, which is
    // not information; §8 OQ-3).
    badge: (tab) =>
      hasRequestBody((tab as HttpRequestTabRecord).state)
        ? { icon: 'symbol-namespace', tooltip: 'This request has a body' }
        : null,
  },
  'grpc-request': {
    mode: TAB_KIND_MODE['grpc-request'],
    title: (tab) => grpcRequestTitle((tab as GrpcRequestTabRecord).state),
    // D2: distinct from 'globe' at a glance in a strip holding both kinds.
    icon: () => 'symbol-interface',
    // D2: no connection, so no rail.
    railColor: () => undefined,
    defaultState: () => defaultGrpcRequestTabState(),
    // D2: a deliberate break with "same target, fresh default state" — a gRPC request's state
    // *is* the request, mirroring 'http-request''s own identical reasoning.
    duplicateState: (tab: GrpcRequestTabRecord): GrpcRequestTabState => ({
      ...tab.state,
      itemId: null,
      name: '',
      importPaths: [...tab.state.importPaths],
      metadata: tab.state.metadata.map((m) => ({ ...m })),
    }),
    // D2: the runtime (and a still-running call) lives in views/grpcrequest/state.ts, freed —
    // and cancelled — by registerTabRuntimeCleanup, not by this hook.
    dropResources: noDrop,
    // D2: there is no project panel to reveal a gRPC request into. P71 §5.2: 'http-request''s own
    // incognitoMenuExtras.
    menuExtras: incognitoMenuExtras,
    parseState: parseStateWith(grpcRequestTabStateSchema),
  },
  'variable-set': {
    mode: TAB_KIND_MODE['variable-set'],
    // D16: the owner's last-known name, falling back to a generic title before the list has
    // loaded after a restore (mirrors HttpRequestTabState's own `name` field's own convention).
    title: (tab) => (tab as VariableSetTabRecord).state.name || 'Variables',
    // D16: collection scope keeps the variable symbol; environment scope reads as a settings
    // surface — distinguishable at a glance in a strip holding both.
    icon: (tab) =>
      (tab as VariableSetTabRecord).state.scope === 'environment'
        ? 'settings-gear'
        : 'symbol-variable',
    // No connection, so no rail — same as the two request kinds.
    railColor: () => undefined,
    // Never reached through a generic "new tab of this kind" affordance — a variable-set tab is
    // always opened contextually (openVariableSetTab) with a real scope/ownerId. This placeholder
    // only satisfies TabKindDef's own required member.
    defaultState: (): VariableSetTabState => ({ scope: 'collection', ownerId: '', name: '' }),
    // A variable set has no variant-to-try story — "duplicate" returns the same target's own
    // state, which is exactly what makes openTab's `reuse: true` correct rather than a bug (F8).
    duplicateState: (tab: VariableSetTabRecord): VariableSetTabState => ({ ...tab.state }),
    // The rows/error runtime lives in api/state/variables.ts, freed by its own
    // registerTabRuntimeCleanup — not by this hook (mirrors http-request's own D2 reasoning).
    dropResources: noDrop,
    // No project-panel reveal for a variable set (mirrors grpc-request's own reasoning).
    menuExtras: () => [],
    parseState: parseStateWith(variableSetTabStateSchema),
  },
  // P28 D16(c): the environment list. No state of its own, one fixed `path`, so openTab's
  // `reuse: true` gives exactly one of these however many times the action is invoked.
  environments: {
    mode: TAB_KIND_MODE.environments,
    title: () => 'Environments',
    icon: () => 'server-environment',
    railColor: () => undefined,
    defaultState: (): EnvironmentsTabState => ({}),
    // Nothing to vary, so a duplicate is the same tab — which is what makes `reuse: true` correct
    // rather than a bug, the same reasoning 'variable-set' above records.
    duplicateState: (): EnvironmentsTabState => ({}),
    // The environment list lives in api/state/variables.ts and is shared with every other Api
    // surface — this tab owns none of it, so closing it frees nothing.
    dropResources: noDrop,
    menuExtras: () => [],
    parseState: parseStateWith(environmentsTabStateSchema),
  },
  // C5 §6.2: the pinned graph placeholder — title reads the workspace's own repo name (falling
  // back to a generic label before that repo's row has loaded, mirroring HttpRequestTabState's own
  // pre-load convention).
  // P100 Part 2: the repo workspace (repo-graph/repo-file/repo-diff/repo-multi-diff) moved to
  // apps/kira-space wholesale — this app never constructs a tab of any of these four kinds again
  // (GitPanel.vue/RepoFileTree.vue/etc., the only callers that ever did, moved with it). They stay
  // in this registry, unreachable, rather than narrowing TAB_KINDS's own key type off TabKind: the
  // registry is deliberately a *total* function over every TabKind (P1 D4's own "no seven-branch
  // if/else" design), which every TAB_KINDS[tab.kind] call site throughout this app (tabs.ts,
  // TabStrip.vue, mode.ts, OperationsPanel.vue) leans on — narrowing the key type would mean
  // auditing and asserting through every one of those, for four kinds that can provably never
  // appear in this app's own tabsState.tabs (kira-space's own model.TabRecord.Validate requires a
  // real workspaceId for all five repo/terminal kinds it renders; this app never opens one).
  // 'terminal' is unaffected — it stays dual-owned (this app's own standalone Terminal module,
  // views/terminal/TerminalView.vue, this phase's other "duplicate, don't hoist" case).
  'repo-graph': unreachableTabKind('repo-graph'),
  'repo-file': unreachableTabKind('repo-file'),
  'repo-diff': unreachableTabKind('repo-diff'),
  'repo-multi-diff': unreachableTabKind('repo-multi-diff'),
  // P83 §7.2: an embedded shell at one worktree's directory, rendered with @xterm/xterm. P85
  // §5.2: a launch's own label (a script's name, or 'Claude Code') wins over the cwd's basename.
  terminal: {
    mode: TAB_KIND_MODE.terminal,
    title: (tab) => {
      const s = (tab as TerminalTabRecord).state;
      return s.label || basename(s.cwd) || 'Terminal';
    },
    // 'terminal-bash', not 'terminal': the 'console' kind (a SQL console) already owns that glyph.
    // The launch kind shows in the title and the rail colour, not a second icon vocabulary.
    icon: () => 'terminal-bash',
    railColor: (tab) => (tab as TerminalTabRecord).state.color,
    defaultState: (): TerminalTabState => ({
      cwd: '',
      codeRepoId: '',
      command: '',
      label: '',
      color: 'none',
      launchKind: 'shell',
    }),
    // Copying the cwd (and command/label/color) means "Duplicate tab" on a terminal opens a
    // second session with the same launch — which needs no special case (§7.2/P85 §5.2).
    duplicateState: (tab: TerminalTabRecord): TerminalTabState => ({ ...tab.state }),
    // The one place a PTY dies on close — blind-called for every kind (dropPageStoresForTab), so
    // a non-terminal tab id is a registry miss here, not a branch.
    dropResources: (tabId) => useTerminalsStore().closeTerminalSession(tabId),
    menuExtras: () => [],
    parseState: parseStateWith(terminalTabStateSchema),
  },
};
