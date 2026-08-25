<script setup lang="ts">
import type { BrowseTabRecord } from '@shared/domain/tabs';
import { decodePath, encodePath, pathTail, type TreeNode } from '@shared/domain/tree';
import { computed, onMounted } from 'vue';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { openUploadDialog } from '../../state/objectStore';
import { openKeyValueTab } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { nodeIcon } from '../../theme/icons';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import { useConnectionGate } from '../shared/useConnectionGate';
import { menuForNode } from './menu';
import { ascend, descend, goToLevel, load, reload, runtime, selectRow, setFilter } from './state';

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
  void reload(props.tab.id);
}

// D18: a plain substring filter over the loaded level, never a second server call.
const filterText = computed({
  get: () => rt.value?.filter ?? '',
  set: (v: string) => setFilter(props.tab.id, v),
});

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

const rowHeight = 28;

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
});
</script>

<template>
  <div class="browse-view" data-testid="browse-view" :data-path="tab.path" :data-level="currentLevelPath">
    <ReconnectGate
      v-if="needsReconnect"
      container-testid="browse-reconnect"
      button-testid="browse-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
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
        <IconButton
          icon="arrow-up"
          data-testid="browse-up"
          :disabled="atRoot"
          v-tooltip="'Up one level'"
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
        <div class="sep" />
        <div class="filter-field">
          <TextField v-model="filterText" placeholder="Filter" data-testid="browse-filter" />
        </div>
        <IconButton
          v-if="canUpload"
          icon="cloud-upload"
          data-testid="browse-upload"
          v-tooltip="'Upload file…'"
          @click="onUploadClick"
        />
        <span class="p-push p-sm muted" data-testid="browse-count">{{ countText }}</span>
      </template>

      <template #strips>
        <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="browse-error">
          {{ rt.error.message }}
        </MessageStrip>
        <!-- P43 F6/D7: a failed delete from this level, distinct from a failed load above. -->
        <MessageStrip v-if="rt?.actionError" tone="err" data-testid="browse-action-error">
          {{ rt.actionError }}
        </MessageStrip>
      </template>

      <div class="p-panel body-panel">
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
        <VirtualList v-else :items="filteredNodes" :row-height="rowHeight" class="body">
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
              <span class="icon-box muted"><CodiconIcon :name="nodeIcon(item.kind)" :size="13" /></span>
              <span class="row-name">{{ item.name }}</span>
              <span v-if="item.detail" class="row-detail muted">{{ item.detail }}</span>
            </div>
          </template>
        </VirtualList>
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
  color: var(--kira-fg-disabled);
}

.filter-field {
  width: 200px;
  flex-shrink: 0;
}

.filter-field :deep(.p-input) {
  width: 100%;
}

.body-panel {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}

.body {
  height: 100%;
}

.empty {
  height: 100%;
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
</style>
