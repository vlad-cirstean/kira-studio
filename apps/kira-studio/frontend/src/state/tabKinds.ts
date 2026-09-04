import type { ConnectionColor } from '@shared/domain/connection';
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
  tabTitle,
} from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { revealPath } from '../project/state/tree';
import { dropForTab as dropConsoleResultPagesForTab } from '../views/console/resultPages';
import { drop as dropDocumentPagesForTab } from '../views/documents/page';
import { drop as dropGridPagesForTab } from '../views/grid/page';
import { httpRequestTitle } from '../views/httprequest/url';
import { drop as dropKeyValuePagesForTab } from '../views/keyvalue/page';
import { drop as dropStreamPagesForTab } from '../views/stream/page';
import { connectionRecord } from './connections';
import type { MenuItem } from './contextMenu';
import { settingsState } from './settings';

// P1 D4/F19: the tab-kind registry, split from workbench/tabViews.ts (C4) by the lint rules —
// this half is component-free (title/icon/railColor/dropResources/menuExtras/state constructors
// only), so it can live in state/ without creating a state/ -> workbench/ edge biome.json forbids
// (F19). Every entry below carries Studio's existing per-kind behaviour verbatim: TabStrip.vue's
// old iconFor body, tabTitle (F10), connectionRecord(tab.connectionId)?.color, and the "Reveal in
// project panel" menu item (F11) — nothing here changes what Studio does, only where it lives.
export interface TabKindDef<K extends TabKind = TabKind> {
  mode: (typeof TAB_KIND_MODE)[K];
  title(tab: TabRecord): string;
  icon(tab: TabRecord): string;
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
}

const KIND_ICON: Record<string, string> = {
  table: 'table',
  view: 'eye',
  matview: 'symbol-structure',
};

function railColor(tab: TabRecord): ConnectionColor | undefined {
  return connectionRecord(tab.connectionId)?.color;
}

// Every Studio kind (F11): a tab addresses a tree node, so "Reveal in project panel" makes sense
// for all seven — an Http tab kind (P2+) supplies its own menuExtras instead, or none at all.
function revealInProjectPanel(tab: TabRecord): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'reveal-in-project-panel',
      label: 'Reveal in project panel',
      icon: 'target',
      run: () => {
        if (tab.connectionId) void revealPath(tab.connectionId, tab.path);
      },
    },
  ];
}

function noDrop(): void {
  // definition/browse have no page store of their own (F12) — nothing to free.
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
    defaultState: () => defaultDataTabState(settingsState.data.defaultPageSize),
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
    defaultState: () => defaultDocumentTabState(settingsState.data.defaultPageSize),
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
    defaultState: () => defaultKeyValueTabState(settingsState.data.defaultPageSize),
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
    defaultState: () => defaultStreamTabState(settingsState.data.defaultPageSize),
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
    duplicateState: (tab: HttpRequestTabRecord): HttpRequestTabState => ({
      ...tab.state,
      headers: tab.state.headers.map((h) => ({ ...h })),
      urlEncoded: tab.state.urlEncoded.map((f) => ({ ...f })),
      formData: tab.state.formData.map((f) => ({ ...f })),
      binaryFile: tab.state.binaryFile ? { ...tab.state.binaryFile } : null,
    }),
    // D2: the response lives in the view's own runtime store (views/httprequest/state.ts),
    // freed by cleanupTabRuntime — there is no page store of this kind's own to drop.
    dropResources: noDrop,
    // D2: there is no project panel to reveal an HTTP request into.
    menuExtras: () => [],
    parseState: parseStateWith(httpRequestTabStateSchema),
  },
};
