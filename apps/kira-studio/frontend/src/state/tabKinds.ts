import type { ConnectionColor } from '@shared/domain/connection';
import { defaultHttpRequestTabState, type HttpRequestTabState } from '@shared/domain/http';
import {
  type BrowseTabRecord,
  type BrowseTabState,
  type ConsoleTabRecord,
  type ConsoleTabState,
  type DataTabRecord,
  type DataTabState,
  type DefinitionTabRecord,
  type DefinitionTabState,
  type DocumentTabRecord,
  type DocumentTabState,
  defaultBrowseTabState,
  defaultConsoleTabState,
  defaultDataTabState,
  defaultDefinitionTabState,
  defaultDocumentTabState,
  defaultKeyValueTabState,
  defaultStreamTabState,
  type HttpRequestTabRecord,
  type KeyValueTabRecord,
  type KeyValueTabState,
  type StreamTabRecord,
  type StreamTabState,
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
    // reason anyone would. Headers are deep-copied since each is an object in an array.
    duplicateState: (tab: HttpRequestTabRecord): HttpRequestTabState => ({
      ...tab.state,
      headers: tab.state.headers.map((h) => ({ ...h })),
    }),
    // D2: the response lives in the view's own runtime store (views/httprequest/state.ts),
    // freed by cleanupTabRuntime — there is no page store of this kind's own to drop.
    dropResources: noDrop,
    // D2: there is no project panel to reveal an HTTP request into.
    menuExtras: () => [],
  },
};
