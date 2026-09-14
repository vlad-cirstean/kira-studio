<script setup lang="ts">
import type { BrowseTabRecord } from '@shared/domain/tabs';
import { decodePath, encodePath, pathTail, type TreeNode } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { openUploadDialog } from '../../state/objectStore';
import { openKeyValueTab } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { nodeIcon, redisTypeIcon } from '../../theme/icons';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PanelSearchBox from '../../theme/primitives/PanelSearchBox.vue';
import PanelSplitter from '../../theme/primitives/PanelSplitter.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import {
  type KeyValueHost,
  registerKeyValueHost,
  unregisterKeyValueHost,
} from '../shared/keyvalue/host';
import KeyValuePane from '../shared/keyvalue/KeyValuePane.vue';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import { menuForNode } from './menu';
import {
  ascend,
  descend,
  ensureKeyTypes,
  goToLevel,
  load,
  reload,
  runtime,
  selectRow,
  setFilter,
  setListWidth,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as every other view.
const props = defineProps<{ tab: BrowseTabRecord }>();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);
const loading = computed(() => rt.value?.status === 'loading');

// P41 D14: '' in session state means "the tab's own container path".
const currentLevelPath = computed(() =>
  props.tab.state.levelPath === '' ? props.tab.path : props.tab.state.levelPath,
);
const atRoot = computed(() => currentLevelPath.value === props.tab.path);

const targetTail = computed(() => pathTail(props.tab.path));
const targetName = computed(() => targetTail.value?.name ?? props.tab.path);
const headerIcon = computed(() => nodeIcon(targetTail.value?.kind ?? 'database'));
const connRecord = computed(() => connectionRecord(props.tab.connectionId));
const pathPrefix = computed(() => (connRecord.value?.name ? `${connRecord.value.name} / ` : ''));

// The breadcrumb: one crumb per path segment from the current level, each a jump target for
// goToLevel (D12) — not just the immediate parent Up already covers.
const crumbs = computed(() => {
  if (!props.tab.connectionId) return [];
  const decoded = decodePath(props.tab.connectionId, currentLevelPath.value);
  return decoded.segments.map((seg, i) => ({
    name: seg.name,
    path: encodePath(decoded.segments.slice(0, i + 1)),
  }));
});

function onCrumbClick(path: string): void {
  if (path === currentLevelPath.value) return;
  void goToLevel(props.tab.id, path);
}

function onUp(): void {
  void ascend(props.tab.id);
}

function onReload(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.tab.id));
}

// D18: a plain substring filter over the loaded level, never a second server call.
const filterText = computed({
  get: () => rt.value?.filter ?? '',
  set: (v: string) => setFilter(props.tab.id, v),
});

// P22b D15: the app's own shared search idiom (HttpRequestView.vue's toggleFieldFilter) replaces
// this file's own always-visible `.filter-field` — `rt.filter`/`filteredNodes`/`countText` below
// are untouched, only the affordance moves. Component-local, not tab state: a lens, not a setting,
// same rule fieldFilterOpen already follows.
const filterOpen = ref(false);
function toggleFilter(): void {
  filterOpen.value = !filterOpen.value;
  // D13's own rule (restated here): closing must restore every hidden row.
  if (!filterOpen.value) filterText.value = '';
}

const filteredNodes = computed<TreeNode[]>(() => {
  const nodes = rt.value?.nodes ?? [];
  const q = filterText.value.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.filter((n) => n.name.toLowerCase().includes(q));
});

const countText = computed(() => {
  const total = rt.value?.nodes.length ?? 0;
  if (filterText.value.trim()) return `${filteredNodes.value.length} of ${total}`;
  return `${total} item${total === 1 ? '' : 's'}`;
});

function onRowClick(node: TreeNode): void {
  selectRow(props.tab.id, node.path);
}

// D12: a container descends; a leaf opens the existing keyvalue tab — the same tab kind the tree
// has always opened a redis key / s3 object into.
function onRowOpen(node: TreeNode): void {
  if (node.hasChildren) {
    void descend(props.tab.id, node.path);
    return;
  }
  if (!props.tab.connectionId) return;
  openKeyValueTab(props.tab.connectionId, node.path);
}

// D10: the moved keyMenu/objectMenu/namespaceMenu/prefixMenu bodies, now addressed by node
// instead of by tree row.
function onRowContextMenu(e: MouseEvent, node: TreeNode): void {
  if (!props.tab.connectionId) return;
  selectRow(props.tab.id, node.path);
  openContextMenu(e, menuForNode(props.tab.id, props.tab.connectionId, node));
}

// P33 D3: the same caps.fileTransfer + canInsert + not-read-only gate uploadMenuItem applies,
// surfaced as a toolbar button too (Console.html-style primary action) rather than only reachable
// through a container row's own context menu.
const canUpload = computed(() => {
  const caps = connectionsState.states[props.tab.connectionId ?? '']?.caps;
  const record = connectionRecord(props.tab.connectionId);
  return !!caps?.fileTransfer && !!caps.canInsert && !record?.readOnly;
});
function onUploadClick(): void {
  if (!props.tab.connectionId) return;
  openUploadDialog(props.tab.connectionId, currentLevelPath.value);
}

// P63 §4.3 step 7: only redis reports Caps().KeyTypes — an S3 browse tab (or any future
// key-browsing engine without a per-key type concept) never issues the call at all.
const keyTypesEnabled = computed(
  () => !!connectionsState.states[props.tab.connectionId ?? '']?.caps?.keyTypes,
);

// Driven by VirtualList's own visible-range event (§4.3): fetches types only for the `key`-kind
// rows currently on screen, never a whole level (up to 200 000 keys). filteredNodes, not rt.nodes
// — the visible RANGE is an index into whatever list VirtualList is actually rendering, and the
// filter toggle can make those two arrays diverge.
function onVisibleRange(range: { start: number; end: number }): void {
  if (!keyTypesEnabled.value) return;
  const nodes = filteredNodes.value;
  const paths: string[] = [];
  for (let i = range.start; i < range.end && i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === 'key') paths.push(node.path);
  }
  if (paths.length > 0) void ensureKeyTypes(props.tab.id, paths);
}

// P63 §4.2: the icon carries the type distinction (no colour — see icons.ts's own comment on
// why); the type also lands in the row's free .row-detail slot as a lowercase text badge, the
// *same* spelling KeyValueView.vue's own type badge renders — one term per concept, so the list
// and the detail header can never disagree. Falls back to the generic glyph/no badge for a row
// whose type hasn't arrived yet (fetched windowed, §4.3) or whose engine has no type concept (S3
// objects are untouched: `nodeIcon('object')` → 'file', no badge).
function rowIcon(item: TreeNode): string {
  if (item.kind !== 'key') return nodeIcon(item.kind);
  return redisTypeIcon(rt.value?.keyTypes.get(item.path));
}
function rowTypeBadge(item: TreeNode): string | null {
  if (item.kind !== 'key') return null;
  return rt.value?.keyTypes.get(item.path) ?? null;
}

const rowHeight = 28;

// --- P63 §2: the vertical split's value pane — list left, value right, `orientation="col"`
// (WorkbenchShell.vue's own project-rail/editor-area splitter is the same navigator/detail
// relationship). PanelSplitter is a pure drag track; the size is owned and persisted here. -------
const DEFAULT_LIST_WIDTH = 320;
const listWidth = computed(() => props.tab.state.listWidth || DEFAULT_LIST_WIDTH);
function onResizeListPane(size: number): void {
  setListWidth(props.tab.id, size);
}

// The selected row's own TreeNode (not just its path) — tells a container apart from a leaf, the
// one thing the detail pane needs to decide between KeyValuePane and its own EmptyState (§2.3).
const selectedNode = computed<TreeNode | null>(
  () => rt.value?.nodes.find((n) => n.path === rt.value?.selected) ?? null,
);
const selectedIsLeaf = computed(() => !!selectedNode.value && !selectedNode.value.hasChildren);
// RedisInsight's own wording, kept per-engine (§4.1) — a bucket's leaf is an object, not a key.
const emptyDetailLabel = computed(() =>
  connRecord.value?.kind === 's3'
    ? 'Select an object to view it'
    : 'Select a key to view its value',
);

// P63 §2.2: the split's own synthetic KeyValueHost, keyed `${tab.id}::preview` (not a real tab
// id) — registered once, for this tab's whole lifetime; `previewHost()` itself reads the
// currently-selected path fresh on every call, so no further registration is needed as the
// selection changes. `pageIndex`/`pageSize` live in BrowseViewRuntime (§5), not session state.
const previewKey = computed(() => `${props.tab.id}::preview`);
function previewHost(): KeyValueHost | null {
  const brt = runtime[props.tab.id];
  if (!brt?.selected || !props.tab.connectionId) return null;
  return {
    connectionId: props.tab.connectionId,
    path: brt.selected,
    pageIndex: brt.previewPageIndex,
    pageSize: brt.previewPageSize,
    patch: (p) => {
      const rtNow = runtime[props.tab.id];
      if (!rtNow) return;
      if (p.pageIndex !== undefined) rtNow.previewPageIndex = p.pageIndex;
      if (p.pageSize !== undefined) rtNow.previewPageSize = p.pageSize;
    },
  };
}

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  registerKeyValueHost(previewKey.value, previewHost);
});

onUnmounted(() => {
  unregisterKeyValueHost(previewKey.value);
});
</script>

<template>
  <div class="browse-view" data-testid="browse-view" :data-path="tab.path" :data-level="currentLevelPath">
    <ViewChrome
      :tab="tab"
      :icon="headerIcon"
      :path="pathPrefix"
      :name="targetName"
      target-testid="browse-target"
      refresh-testid="browse-refresh"
      stop-testid="browse-stop"
      :can-refresh="true"
      :can-stop="false"
      @refresh="onReload"
    >
      <template #toolbar>
        <!-- §3.2: back-navigation and the breadcrumb move into .list-head, with the list they
             navigate — this toolbar keeps only what's view-scoped rather than navigator-scoped. -->
        <IconButton
          icon="search"
          :active="filterOpen"
          v-tooltip="'Filter'"
          data-testid="browse-filter-toggle"
          @click="toggleFilter"
        />
        <IconButton
          v-if="canUpload"
          icon="cloud-upload"
          data-testid="browse-upload"
          v-tooltip="'Upload file…'"
          @click="onUploadClick"
        />
      </template>

      <template #strips>
        <PanelSearchBox
          v-if="filterOpen"
          v-model="filterText"
          placeholder="Filter"
          testid="browse-filter"
        />
        <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="browse-error">
          {{ rt.error.message }}
        </MessageStrip>
        <!-- P43 F6/D7: a failed delete from this level, distinct from a failed load above. -->
        <MessageStrip v-if="rt?.actionError" tone="err" data-testid="browse-action-error">
          {{ rt.actionError }}
        </MessageStrip>
        <!-- P43 iter2 F16/D23: the adapter's own round budget cut this level's listing short —
             nothing failed, the listing is real, it's just incomplete. -->
        <MessageStrip v-if="rt?.truncated" tone="warn" icon="warning" data-testid="browse-truncated">
          This level stopped short of the full listing — Refresh to try again.
        </MessageStrip>
      </template>

      <!-- Item 4: the reconnect gate used to replace this whole ViewChrome (header, toolbar and
           all) — every other view but the grid's DataView.vue did the same, the one inconsistency
           this fixes. ViewChrome itself (and so its toolbar slots above) now always renders; only
           the body — the part that actually needs a live connection — swaps for the gate. -->
      <ReconnectGate
        v-if="needsReconnect"
        container-testid="browse-reconnect"
        button-testid="browse-reconnect-load"
        @reconnect="onReconnectAndLoad"
      />
      <!-- P63 §2.1: a vertical split — list left, value right (orientation="col", matching
           WorkbenchShell.vue's own project-rail/editor-area splitter). Nothing about ViewChrome/
           PanelSplitter/VirtualList changes; this is the only new geometry. -->
      <div v-else class="browse-body">
        <div class="list-pane p-panel" :style="{ width: `${listWidth}px` }">
          <!-- §3.2: reuses .p-toolbar band styling (PanelSplitter.vue names it as one of the
               surfaces whose border weight the design system already fixes) rather than inventing
               a header — same 26px in-view band every other toolbar uses. -->
          <div class="list-head p-toolbar">
            <IconButton
              icon="chevron-left"
              data-testid="browse-up"
              :disabled="atRoot"
              v-tooltip="'Back'"
              @click="onUp"
            />
            <span class="breadcrumb">
              <template v-for="(crumb, i) in crumbs" :key="crumb.path">
                <span v-if="i > 0" class="crumb-sep">/</span>
                <button
                  type="button"
                  class="crumb"
                  data-testid="browse-crumb"
                  :class="{ 'is-current': i === crumbs.length - 1 }"
                  @click="onCrumbClick(crumb.path)"
                >
                  {{ crumb.name }}
                </button>
              </template>
            </span>
            <span class="p-push p-sm muted" data-testid="browse-count">{{ countText }}</span>
          </div>
          <div v-if="!rt || (loading && rt.nodes.length === 0)" class="empty muted">Loading…</div>
          <div v-else-if="rt.nodes.length === 0" class="empty muted" data-testid="browse-empty">
            No items
          </div>
          <div
            v-else-if="filteredNodes.length === 0"
            class="empty muted"
            data-testid="browse-empty"
          >
            No matching items
          </div>
          <VirtualList
            v-else
            :items="filteredNodes"
            :row-height="rowHeight"
            class="body"
            @visible-range="onVisibleRange"
          >
            <template #default="{ item }">
              <div
                class="browse-row"
                data-testid="browse-row"
                :data-path="item.path"
                :data-kind="item.kind"
                :class="{ selected: rt?.selected === item.path }"
                :style="{ height: `${rowHeight}px` }"
                @click="onRowClick(item)"
                @dblclick="onRowOpen(item)"
                @contextmenu.prevent="onRowContextMenu($event, item)"
              >
                <span class="icon-box muted"><CodiconIcon :name="rowIcon(item)" :size="13" /></span>
                <span class="row-name">{{ item.name }}</span>
                <span v-if="item.detail" class="row-detail muted">{{ item.detail }}</span>
                <span
                  v-else-if="rowTypeBadge(item)"
                  class="p-badge"
                  data-testid="browse-key-type"
                >{{ rowTypeBadge(item) }}</span>
              </div>
            </template>
          </VirtualList>
        </div>
        <PanelSplitter
          orientation="col"
          :size="listWidth"
          :min="220"
          :max="900"
          divider
          data-testid="browse-splitter"
          @resize="onResizeListPane"
        />
        <div class="detail-pane" data-testid="browse-detail-pane">
          <template v-if="selectedIsLeaf">
            <KeyValuePane :view-key="previewKey" :standalone="false" />
            <CellEditorDock :tab-id="previewKey" />
          </template>
          <EmptyState v-else icon="key" :label="emptyDetailLabel" data-testid="browse-detail-empty" />
        </div>
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.browse-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--kira-s-1);
  min-width: 0;
  overflow: hidden;
}

.crumb {
  background: none;
  border: none;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  padding: 0 var(--kira-s-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb:hover {
  color: var(--kira-fg);
  text-decoration: underline;
}

.crumb.is-current {
  color: var(--kira-fg);
  cursor: default;
}

.crumb.is-current:hover {
  text-decoration: none;
}

.crumb-sep {
  color: var(--kira-fg-subtle);
}

.browse-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.list-pane {
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none;
  border-radius: 0;
}

.detail-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.body {
  flex: 1;
  min-height: 0;
  height: auto;
}

.empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--kira-t-sm);
}

.browse-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-4);
  cursor: default;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.browse-row:hover {
  background: var(--kira-hover);
}

.browse-row.selected {
  background: var(--kira-select);
}

.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-detail {
  flex-shrink: 0;
  font-size: var(--kira-t-xs);
}

.browse-row .p-badge {
  flex-shrink: 0;
}
</style>
