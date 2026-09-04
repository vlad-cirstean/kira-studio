import type { TabKind } from '@shared/domain/tabs';
import type { Component } from 'vue';
import BrowseTabView from '../views/browse/BrowseView.vue';
import ConsoleTabView from '../views/console/ConsoleView.vue';
import DefinitionTabView from '../views/definition/DefinitionView.vue';
import DocumentTabView from '../views/documents/DocumentView.vue';
import DataTabView from '../views/grid/DataView.vue';
import KeyValueTabView from '../views/keyvalue/KeyValueView.vue';
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
};
