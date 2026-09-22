import type { TabKind } from '@shared/domain/tabs';
import type { Component } from 'vue';
import EnvironmentsTabView from '../api/EnvironmentsView.vue';
import VariableSetTabView from '../api/VariableSetView.vue';
import BrowseTabView from '../views/browse/BrowseView.vue';
import ConsoleTabView from '../views/console/ConsoleView.vue';
import DefinitionTabView from '../views/definition/DefinitionView.vue';
import DocumentTabView from '../views/documents/DocumentView.vue';
import DataTabView from '../views/grid/DataView.vue';
import GrpcRequestTabView from '../views/grpcrequest/GrpcRequestView.vue';
import HttpRequestTabView from '../views/httprequest/HttpRequestView.vue';
import KeyValueTabView from '../views/keyvalue/KeyValueView.vue';
import StreamTabView from '../views/stream/StreamView.vue';
import TerminalTabView from '../views/terminal/TerminalView.vue';

// P100 Part 2: state/tabKinds.ts's own unreachableTabKind — a component this app can provably
// never actually mount (its four kinds' own TAB_KINDS entries throw before any view would ever
// receive such a tab), kept only so TAB_VIEWS stays a total function over every TabKind. See that
// file's own comment on the repo-* entries below for why this isn't a narrower key type instead.
const NeverRenderedTabView: Component = () => null;

// P1 D4: the component half of the tab-kind registry — split from state/tabKinds.ts because
// state/ -> workbench/ is a lint-forbidden edge (F19), while workbench/ -> views/ is not. STATIC
// imports, deliberately: this is a registry lookup, not a lazy-load boundary, so the bundle keeps
// exactly the two dynamic chunks docs/ARCHITECTURE.md:28 records (sql-formatter, @faker-js/faker).
export const TAB_VIEWS: Record<TabKind, Component> = {
  data: DataTabView,
  definition: DefinitionTabView,
  console: ConsoleTabView,
  document: DocumentTabView,
  keyvalue: KeyValueTabView,
  stream: StreamTabView,
  browse: BrowseTabView,
  'http-request': HttpRequestTabView,
  'grpc-request': GrpcRequestTabView,
  'variable-set': VariableSetTabView,
  environments: EnvironmentsTabView,
  // P100 Part 2: the repo workspace moved to apps/kira-space wholesale (state/tabKinds.ts's own
  // comment on its unreachableTabKind entries for these same four kinds).
  'repo-graph': NeverRenderedTabView,
  'repo-file': NeverRenderedTabView,
  'repo-diff': NeverRenderedTabView,
  'repo-multi-diff': NeverRenderedTabView,
  // P83 §6.2: the embedded terminal — a static entry like every kind above; @xterm/xterm itself
  // stays behind terminalRenderer.ts's own dynamic import(). P100 Part 2: this app's own standalone
  // Terminal module's renderer, duplicated from (not shared with) apps/kira-space's repo-worktree
  // one — views/terminal/TerminalView.vue's own doc comment.
  terminal: TerminalTabView,
};
