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
import RepoDiffTabView from '../views/repo/RepoDiffView.vue';
import RepoFileTabView from '../views/repo/RepoFileView.vue';
import RepoGraphTabView from '../views/repo/RepoGraphView.vue';
import RepoTerminalTabView from '../views/repo/RepoTerminalView.vue';
import StreamTabView from '../views/stream/StreamView.vue';

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
  // C5 §6.2/§12: the pinned graph tab (a placeholder at C5, replaced wholesale by C10 with the
  // real @kira/git-ui mount) and the file viewer (a no-op placeholder until S12's Monaco mount
  // lands, S10's own note).
  'repo-graph': RepoGraphTabView,
  'repo-file': RepoFileTabView,
  // C6 §8.1: the HEAD-vs-worktree diff mount.
  'repo-diff': RepoDiffTabView,
  // P83 §6.2: the embedded terminal — a static entry like every kind above; @xterm/xterm itself
  // stays behind terminalRenderer.ts's own dynamic import(), RepoFileTabView's own Monaco pattern.
  terminal: RepoTerminalTabView,
};
