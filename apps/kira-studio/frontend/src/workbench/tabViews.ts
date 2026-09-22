import type { TabViewMap } from '@workbench/tabs/types';
import EnvironmentsTabView from '../api/EnvironmentsView.vue';
import VariableSetTabView from '../api/VariableSetView.vue';
import type { StudioTabKind } from '../state/tabDomain';
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

// P1 D4: the component half of the tab-kind registry — split from state/tabKinds.ts because
// state/ -> workbench/ is a lint-forbidden edge (F19), while workbench/ -> views/ is not. STATIC
// imports, deliberately: this is a registry lookup, not a lazy-load boundary, so the bundle keeps
// exactly the two dynamic chunks docs/ARCHITECTURE.md:28 records (sql-formatter, @faker-js/faker).
// P103 Part 2 (§5.1): the repo-graph/repo-file/repo-diff/repo-multi-diff entries this map used to
// carry as `NeverRenderedTabView` stubs are gone along with `unreachableTabKind` in
// state/tabKinds.ts — `StudioTabKind` no longer includes those four kinds, so this is a total
// function over this app's own real vocabulary again.
export const TAB_VIEWS: TabViewMap<StudioTabKind> = {
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
  // P83 §6.2: the embedded terminal — a static entry like every kind above; @xterm/xterm itself
  // stays behind terminalRenderer.ts's own dynamic import(). P100 Part 2: this app's own standalone
  // Terminal module's renderer, duplicated from (not shared with) apps/kira-space's repo-worktree
  // one — views/terminal/TerminalView.vue's own doc comment.
  terminal: TerminalTabView,
};
