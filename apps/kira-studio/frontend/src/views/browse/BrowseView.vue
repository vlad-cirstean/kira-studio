<script setup lang="ts">
import { decodePath, encodePath, pathTail, type TreeNode } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { useDebounceFn } from '@vueuse/core';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { useVirtualRows } from '@workbench/util/virtualRows';
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { useConnectionsStore } from '../../state/connections';
import { useObjectStoreStore } from '../../state/objectStore';
import { useRunState } from '../../state/runState';
import type { BrowseTabRecord } from '../../state/tabDomain';
import { useTabsStore } from '../../state/tabs';
import EngineIcon from '../../theme/EngineIcon.vue';
import { nodeIcon, redisTypeIcon, redisTypeLabel } from '../../theme/icons';
import {
  type KeyValueHost,
  registerKeyValueHost,
  unregisterKeyValueHost,
} from '../shared/keyvalue/host';
import KeyValuePane from '../shared/keyvalue/KeyValuePane.vue';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import { menuForNode } from './menu';
import { useBrowseViewStore } from './state';

const contextMenuStore = useContextMenuStore();

// MainView.vue keys this component by tab.id — same discipline as every other view.
const props = defineProps<{ tab: BrowseTabRecord }>();

const objectStoreStore = useObjectStoreStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const browseViewStore = useBrowseViewStore();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => browseViewStore.load(props.tab.id),
);

const rt = computed(() => browseViewStore.runtime[props.tab.id]);
const loading = computed(() => rt.value?.status === 'loading');

// P41 D14: '' in session state means "the tab's own container path".
const currentLevelPath = computed(() =>
  props.tab.state.levelPath === '' ? props.tab.path : props.tab.state.levelPath,
);
const atRoot = computed(() => currentLevelPath.value === props.tab.path);

const targetTail = computed(() => pathTail(props.tab.path));
const targetName = computed(() => targetTail.value?.name ?? props.tab.path);
const headerIcon = computed(() => nodeIcon(targetTail.value?.kind ?? 'database'));
const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const pathPrefix = computed(() => (connRecord.value?.name ? `${connRecord.value.name} / ` : ''));

// P104 §3: ViewChrome/ViewHeader/RunState inlined -- railColor mirrors ViewChrome.vue's own
// `envColor ?? (connection ? connection.color ?? null : undefined)`; this view has no envColor.
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});

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
  void browseViewStore.goToLevel(props.tab.id, path);
}

function onUp(): void {
  void browseViewStore.ascend(props.tab.id);
}

function onReload(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () =>
    browseViewStore.reload(props.tab.id),
  );
}

// D18: a plain substring filter over the loaded level, never a second server call.
const filterText = computed({
  get: () => rt.value?.filter ?? '',
  set: (v: string) => browseViewStore.setFilter(props.tab.id, v),
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

// P63 §2.1/§2.2: the vertical split's own state. `listWidth` mirrors HttpRequestView.vue's own
// requestPaneHeight persistence idiom — `0` means "the default", so a tab saved before this field
// existed restores unchanged.
const DEFAULT_LIST_WIDTH = 320;
const listWidth = computed(() => props.tab.state.listWidth || DEFAULT_LIST_WIDTH);
function onResizeList(size: number): void {
  tabsStore.patchBrowseTabState(props.tab.id, { listWidth: size });
}

// The detail pane previews the selected row when it's a leaf (hasChildren: false) — a container
// row, or nothing selected, has no value of its own to show (§2.3).
const selectedNode = computed<TreeNode | null>(() => {
  const selected = rt.value?.selected;
  if (!selected) return null;
  return rt.value?.nodes.find((n) => n.path === selected) ?? null;
});
const previewable = computed(() => !!selectedNode.value && !selectedNode.value.hasChildren);
const emptyPreviewLabel = computed(() =>
  targetTail.value?.kind === 'bucket'
    ? 'Select an object to view it'
    : 'Select a key to view its value',
);
const emptyPreviewIcon = computed(() => (targetTail.value?.kind === 'bucket' ? 'file' : 'tag'));

// §2.2: a non-tab viewKey, registered once for this tab's whole lifetime — its own resolver reads
// `rt` fresh on every call, so it never needs re-registering as selection changes. `path` reads
// `rt.selected` directly rather than `selectedNode`/`previewable`: KeyValuePane is only ever
// mounted while `previewable` holds (below), so a container's own path here is simply never read.
const previewKey = `${props.tab.id}::preview`;
registerKeyValueHost(previewKey, (): KeyValueHost | null => {
  const r = rt.value;
  if (!r?.selected) return null;
  return {
    connectionId: props.tab.connectionId,
    path: r.selected,
    pageIndex: r.previewPageIndex,
    pageSize: r.previewPageSize,
    patch: (p) => {
      const target = rt.value;
      if (!target) return;
      if (p.pageIndex !== undefined) target.previewPageIndex = p.pageIndex;
      if (p.pageSize !== undefined) target.previewPageSize = p.pageSize;
    },
  };
});
onUnmounted(() => unregisterKeyValueHost(previewKey));

// D12 (§2.3 extends it, not replaces it): a single click still just selects the row — the detail
// pane above reacts to `rt.selected` on its own (KeyValuePane's own watch on its resolved host
// path), so no separate "load into the right pane" call belongs here.
function onRowClick(node: TreeNode): void {
  browseViewStore.selectRow(props.tab.id, node.path);
}

// P63 §4.3: gates the whole per-type fetch — an S3 browse tab (caps.keyTypes false) never issues
// treeKeyTypes at all, not just gets an empty answer from it.
const supportsKeyTypes = computed(
  () => !!connectionsStore.states[props.tab.connectionId ?? '']?.caps?.keyTypes,
);

// Reads through `keyTypesVersion` so this re-renders when ensureKeyTypes below fills in a path —
// `rt.keyTypes` itself is markRaw'd (browse/state.ts's own doc comment), so the Map's own mutation
// is invisible to Vue without this.
function keyType(path: string): string | undefined {
  void rt.value?.keyTypesVersion;
  return rt.value?.keyTypes.get(path);
}

// 7c (P68 review): VirtualList's own `visible-range` emit fires up to once per animation frame
// during a scroll fling — each distinct window used to issue its own IPC round trip even though
// path-level dedup (ensureKeyTypes' own pending/keyTypes checks) only prevents REPEATING work, not
// the round trip itself. Debounced by the same 150ms blameAnnotation.ts's own DEBOUNCE_MS already
// uses, so a fling settles on one ensureKeyTypes call for its final window instead of one per frame.
const KEY_TYPES_DEBOUNCE_MS = 150;
const ensureKeyTypesDebounced = useDebounceFn((range: { start: number; end: number }) => {
  const nodes = filteredNodes.value;
  const paths: string[] = [];
  for (let i = range.start; i < range.end && i < nodes.length; i++) {
    const node = nodes[i];
    if (node && node.kind === 'key') paths.push(node.path);
  }
  if (paths.length > 0) browseViewStore.ensureKeyTypes(props.tab.id, paths);
}, KEY_TYPES_DEBOUNCE_MS);
onBeforeUnmount(() => ensureKeyTypesDebounced.cancel());

// D12: a container descends; a leaf opens the existing keyvalue tab — the same tab kind the tree
// has always opened a redis key / s3 object into.
function onRowOpen(node: TreeNode): void {
  if (node.hasChildren) {
    void browseViewStore.descend(props.tab.id, node.path);
    return;
  }
  if (!props.tab.connectionId) return;
  tabsStore.openKeyValueTab(props.tab.connectionId, node.path);
}

// P105 §5.2(c): Enter opens (matching double-click); Space mirrors a single click.
function onRowKeydown(e: KeyboardEvent, node: TreeNode): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    onRowOpen(node);
  } else if (e.key === ' ') {
    e.preventDefault();
    onRowClick(node);
  }
}

// D10: the moved keyMenu/objectMenu/namespaceMenu/prefixMenu bodies, now addressed by node
// instead of by tree row.
function onRowContextMenu(e: MouseEvent, node: TreeNode): void {
  if (!props.tab.connectionId) return;
  browseViewStore.selectRow(props.tab.id, node.path);
  contextMenuStore.openContextMenu(e, menuForNode(props.tab.id, props.tab.connectionId, node));
}

// P33 D3: the same caps.fileTransfer + canInsert + not-read-only gate uploadMenuItem applies,
// surfaced as a toolbar button too (Console.html-style primary action) rather than only reachable
// through a container row's own context menu.
const canUpload = computed(() => {
  const caps = connectionsStore.states[props.tab.connectionId ?? '']?.caps;
  const record = connectionsStore.connectionRecord(props.tab.connectionId);
  return !!caps?.fileTransfer && !!caps.canInsert && !record?.readOnly;
});
function onUploadClick(): void {
  if (!props.tab.connectionId) return;
  objectStoreStore.openUploadDialog(props.tab.connectionId, currentLevelPath.value);
}

const rowHeight = 28;

// P104 §3.4: VirtualList's own recipe, rebuilt on @tanstack/vue-virtual via the shared
// useVirtualRows composable.
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => filteredNodes.value.length,
  rowHeight: () => rowHeight,
  scrollElement: scrollEl,
});

// VirtualList's own visible-range emit (already used by KeyValuePane's identical need) — windowed
// per §4.3, never the whole (up to 200 000-key) level.
watch(virtualItems, (items) => {
  if (!supportsKeyTypes.value || items.length === 0) return;
  void ensureKeyTypesDebounced({ start: items[0].index, end: items[items.length - 1].index + 1 });
});

onMounted(() => {
  if (!needsReconnect.value && !browseViewStore.runtime[props.tab.id]) {
    void browseViewStore.load(props.tab.id);
  }
});
</script>

<template>
  <div class="browse-view" data-testid="browse-view" :data-path="tab.path" :data-level="currentLevelPath">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined -- no component wraps this chrome anymore. -->
    <div class="p-view-head">
      <span
        v-if="railColor !== undefined"
        class="p-conn-dot"
        :class="{ none: !railColor || railColor === 'none' }"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span v-if="connRecord?.kind" class="icon-box">
        <EngineIcon :kind="connRecord.kind" :size="13" />
      </span>
      <span class="icon-box">
        <CodiconIcon :name="headerIcon" :size="13" />
      </span>
      <span class="p-view-target" data-testid="browse-target"
        ><span v-if="pathPrefix" class="path">{{ pathPrefix }}</span
        >{{ targetName }}</span
      >
      <span class="p-push flex items-center gap-1"></span>
    </div>

    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar last">
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira-icon" data-testid="browse-refresh" aria-label="Refresh" @click="onReload">
              <CodiconIcon name="refresh" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
        <!-- P63 §3.2: navigator-scoped controls (back + breadcrumb + count) moved into the list
             pane's own .list-head band, alongside the VirtualList they act on — this toolbar keeps
             only what is view-scoped: filter, upload, and the refresh/stop group above. -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': filterOpen }"
              aria-label="Filter"
              data-testid="browse-filter-toggle"
              @click="toggleFilter"
            >
              <CodiconIcon name="search" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filter</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canUpload">
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              aria-label="Upload file…"
              data-testid="browse-upload"
              @click="onUploadClick"
            >
              <CodiconIcon name="cloud-upload" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload file…</TooltipContent>
        </Tooltip>
      <span class="p-push" />
      <Tooltip :disabled="true">
        <TooltipTrigger as-child>
          <span
            class="p-run-state inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
            :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
          >
            <span class="label min-w-[7ch] text-right">{{ runStateLabel }}</span
            ><span
              class="ring h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
              :class="{
                'animate-kira-spin border-t-accent border-r-transparent border-b-accent border-l-accent':
                  runState.status === 'running',
                'border-error': runState.status === 'error',
              }"
            />
          </span>
        </TooltipTrigger>
      </Tooltip>
      <div class="group"></div>
    </div>

        <div v-if="filterOpen" class="shrink-0 px-1.5 py-1 border-b border-border">
          <div
            class="flex items-center gap-1 w-full h-control rounded-kira-sm border border-border-strong bg-field px-2"
          >
            <CodiconIcon name="search" :size="13" class="shrink-0 text-fg-muted" />
            <Input
              :model-value="filterText"
              placeholder="Filter"
              class="h-full w-full border-0 bg-transparent p-0 font-ui focus-visible:ring-0"
              data-testid="browse-filter"
              @update:model-value="(v) => (filterText = String(v))"
            />
            <Tooltip v-if="filterText">
              <TooltipTrigger as-child>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Clear search"
                  data-testid="browse-filter-clear"
                  @click="filterText = ''"
                >
                  <CodiconIcon name="close" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear search</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="browse-error">
          <AlertDescription>{{ rt.error.message }}</AlertDescription>
        </Alert>
        <!-- P43 F6/D7: a failed delete from this level, distinct from a failed load above. -->
        <Alert v-if="rt?.actionError" variant="destructive" data-testid="browse-action-error">
          <AlertDescription>{{ rt.actionError }}</AlertDescription>
        </Alert>
        <!-- P43 iter2 F16/D23: the adapter's own round budget cut this level's listing short —
             nothing failed, the listing is real, it's just incomplete. -->
        <Alert v-if="rt?.truncated" class="strip-warn" data-testid="browse-truncated">
          <CodiconIcon name="warning" :size="13" class="strip-warn-text" />
          <AlertDescription class="strip-warn-text">
            This level stopped short of the full listing — Refresh to try again.
          </AlertDescription>
        </Alert>

      <!-- Item 4: the reconnect gate used to replace this whole chrome (header, toolbar and
           all) — every other view but the grid's DataView.vue did the same, the one inconsistency
           this fixes. The chrome above (and so its toolbar rows) now always renders; only
           the body — the part that actually needs a live connection — swaps for the gate.
           P63 §2.1: "the body" is now the whole split (list pane + splitter + detail pane), never
           just the list — a disconnected connection means neither side has anything live to show. -->
      <div v-if="needsReconnect" class="p-empty" data-testid="browse-reconnect">
        <Button variant="dialog-primary" size="kira-lg" data-testid="browse-reconnect-load" @click="onReconnectAndLoad">
          Reconnect & load
        </Button>
      </div>
      <SplitterGroup v-else direction="horizontal" class="browse-body">
        <SplitterPanel
          class="list-pane"
          size-unit="px"
          :default-size="listWidth"
          :min-size="220"
          :max-size="900"
          :order="1"
          @resize="onResizeList"
        >
          <!-- P63 §3.2: back + breadcrumb + count — navigator-scoped controls, moved out of
               ViewChrome's own toolbar into the pane whose list they act on. Reuses `.p-toolbar`
               styling (the same 26px in-view band every other toolbar already is) rather than
               inventing a header. -->
          <div class="p-toolbar list-head" data-testid="browse-list-head">
            <Tooltip>
              <TooltipTrigger as-child>
                <TooltipDisabledTrigger>
                  <Button
                    variant="toolbar"
                    size="kira-icon"
                    :disabled="atRoot"
                    aria-label="Back"
                    data-testid="browse-up"
                    @click="onUp"
                  >
                    <CodiconIcon name="chevron-left" :size="13" />
                  </Button>
                </TooltipDisabledTrigger>
              </TooltipTrigger>
              <TooltipContent>Back</TooltipContent>
            </Tooltip>
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
            <div
              v-else
              ref="scrollEl"
              class="body overflow-auto"
              data-testid="virtual-list"
              role="listbox"
              aria-label="Keys"
              @scroll="onScroll"
            >
              <div :style="{ height: `${totalSize}px`, position: 'relative' }">
                <div
                  v-for="vi in virtualItems"
                  :key="String(vi.key)"
                  class="browse-row virtual-row"
                  data-testid="browse-row"
                  :data-path="filteredNodes[vi.index]?.path"
                  :data-kind="filteredNodes[vi.index]?.kind"
                  :class="{ selected: rt?.selected === filteredNodes[vi.index]?.path }"
                  :style="{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selected === filteredNodes[vi.index]?.path"
                  @click="onRowClick(filteredNodes[vi.index]!)"
                  @dblclick="onRowOpen(filteredNodes[vi.index]!)"
                  @keydown="onRowKeydown($event, filteredNodes[vi.index]!)"
                  @contextmenu.prevent="onRowContextMenu($event, filteredNodes[vi.index]!)"
                >
                  <!-- P63 §4.2/§4.3: a redis key's icon becomes its per-type glyph once its TYPE
                       has arrived (redisTypeIcon falls back to the generic key glyph otherwise —
                       never a wrong type). S3 objects and every container kind are unaffected. -->
                  <span class="icon-box muted"
                    ><CodiconIcon
                      :name="
                        filteredNodes[vi.index]?.kind === 'key'
                          ? redisTypeIcon(keyType(filteredNodes[vi.index]!.path))
                          : nodeIcon(filteredNodes[vi.index]!.kind)
                      "
                      :size="13"
                  /></span>
                  <span class="row-name">{{ filteredNodes[vi.index]?.name }}</span>
                  <span
                    v-if="
                      filteredNodes[vi.index]?.kind === 'key' &&
                      redisTypeLabel(keyType(filteredNodes[vi.index]!.path))
                    "
                    class="p-badge row-type-badge"
                    data-testid="browse-key-type"
                    >{{ redisTypeLabel(keyType(filteredNodes[vi.index]!.path)) }}</span
                  >
                  <span v-if="filteredNodes[vi.index]?.detail" class="row-detail muted">{{
                    filteredNodes[vi.index]?.detail
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </SplitterPanel>

        <SplitterResizeHandle class="browse-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />

        <SplitterPanel class="detail-pane" data-testid="browse-detail-pane" :order="2">
          <KeyValuePane v-if="previewable" :view-key="previewKey" />
          <Alert v-else class="preview-empty" data-testid="browse-preview-empty">
            <CodiconIcon :name="emptyPreviewIcon" :size="24" class="text-subtle" />
            <AlertTitle class="text-kira-md text-muted-foreground font-normal">{{ emptyPreviewLabel }}</AlertTitle>
          </Alert>
        </SplitterPanel>
      </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.browse-view {
  @apply h-full flex flex-col min-h-0;
}

.breadcrumb {
  @apply flex items-center min-w-0 overflow-hidden gap-0.5;
}

.crumb {
  @apply cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis border-0 bg-none text-muted-foreground text-kira-sm px-0.5;
}

.crumb:hover {
  @apply text-fg underline;
}

.crumb.is-current {
  @apply text-fg cursor-default;
}

.crumb.is-current:hover {
  @apply no-underline;
}

.crumb-sep {
  @apply text-subtle;
}

/* P63 §2.1: list pane (left) | splitter | detail pane (right) — the vertical split. */
.browse-body {
  @apply flex flex-row flex-1 min-h-0;
}

/* SplitterPanel's own inline style now owns flex-grow/basis (it always wins over a class rule) —
   min-w-0/flex layout is all this class still needs to contribute (HttpRequestView.vue's own
   .response-pane-slot precedent). */
.list-pane {
  @apply min-w-0 flex flex-col min-h-0;
}

.detail-pane {
  @apply min-w-0 flex flex-col min-h-0;
}

/* P104 §3.3: reka's SplitterResizeHandle carries no divider styling of its own — this reproduces
   PanelSplitter.vue's old `divider` prop line exactly (a centred inset box-shadow, cleared on
   hover/drag, --kira-focus fill taking over instead), mirroring HttpRequestView.vue's own
   .request-splitter for the horizontal (col-resize) case. */
.browse-splitter {
  @apply shrink-0 w-1 cursor-col-resize bg-transparent hover:bg-focus data-[state='drag']:bg-focus;
  box-shadow: inset calc(var(--kira-border-width) * -1) 0 0 0 var(--kira-border);
}
.browse-splitter:hover,
.browse-splitter[data-state='drag'] {
  box-shadow: none;
}

.body-panel {
  @apply flex-1 min-h-0 border-0 rounded-none;
}

.body {
  @apply h-full;
}

.virtual-row {
  @apply absolute top-0 left-0 w-full;
}

.empty {
  @apply h-full flex items-center justify-center text-kira-sm;
}

/* Alert tone class replacing MessageStrip's own warn-tone colors (now --kira-warn-text/--kira-
   note-text in tokens.css, promoted off this rule's literal-hex carve-out). */
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-warn-text;
}

/* Replaces EmptyState.vue's own `.p-empty` shape for the detail pane's unselected state. */
.preview-empty {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}

.browse-row {
  @apply flex items-center cursor-default border-b border-border gap-1 px-2;
}

.browse-row:hover {
  @apply bg-hover;
}

.browse-row.selected {
  @apply bg-select;
}

.row-name {
  @apply flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap;
}

.row-detail {
  @apply shrink-0 text-kira-xs;
}

.row-type-badge {
  @apply shrink-0;
}
</style>
