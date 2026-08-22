<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { connectionsState } from '../../project/state/connections';
import { runningOpId, cancelOp } from '../state/ops';
import Codicon from '../../theme/Codicon.vue';
import { countAll, jumpToPage, loadTabData, pageFirst, pageLast, pageNext, pagePrev } from '../state/data';
import { getPage, tabsState, updateTabState, pageSizeOptions, findDataTab } from '../state/tabs';

// §8.5 data-view toolbar (P2 D7/D8/D9/D18/D20). Left to right: pager · page size · refresh · count
// all · stop · columns ▸ · right-aligned status. Tinted with the connection colour (2 px top
// border, matching the tab strip).

const props = defineProps<{ tabId: string }>();

const tab = computed(() => findDataTab(props.tabId));
const view = computed(() => getPage(props.tabId));

const color = computed(() => {
  const t = tab.value;
  if (!t) return 'transparent';
  const c = connectionsState.records.find((r) => r.id === t.connectionId)?.color;
  return c ? `var(--kira-conn-${c})` : 'transparent';
});

const totalPages = computed(() => {
  const t = tab.value;
  if (!t || t.state.totalRows === null) return null;
  return Math.max(1, Math.ceil(t.state.totalRows / t.state.pageSize));
});

const canLast = computed(() => totalPages.value !== null);
const running = computed(() => (tab.value ? runningOpId(tab.value.id) : null));const busy = computed(() => running.value !== null);

const pageInput = ref('1');
watch(
  () => tab.value?.state.pageIndex ?? 1,
  (v) => {
    pageInput.value = String(v);
  },
  { immediate: true },
);

// 150 ms inline progress bar (§2.1): a single setTimeout armed at dispatch, cleared on settle — not
// a ticking timer.
const showProgress = ref(false);
let progressTimer: ReturnType<typeof setTimeout> | null = null;
watch(busy, (b) => {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  if (b) {
    progressTimer = setTimeout(() => {
      showProgress.value = true;
    }, 150);
  } else {
    showProgress.value = false;
  }
});

const projectionOpen = ref(false);
const allColumns = computed(() => {
  const v = view.value;
  return v ? v.columns.map((c) => c.name) : [];
});

function toggleProjection(column: string): void {
  const t = tab.value;
  if (!t) return;
  const current = new Set(t.state.projection ?? allColumns.value);
  if (current.has(column)) current.delete(column);
  else current.add(column);
  const projection = current.size === allColumns.value.length ? null : [...allColumns.value].filter((c) => current.has(c));
  updateTabState(t.id, { projection, cursor: { kind: 'offset', offset: 0 }, pageIndex: 1 });
  void loadTabData(t.id);
}

function setProjectionAll(): void {
  const t = tab.value;
  if (!t) return;
  updateTabState(t.id, { projection: null, cursor: { kind: 'offset', offset: 0 }, pageIndex: 1 });
  void loadTabData(t.id);
}

function setProjectionNone(): void {
  const t = tab.value;
  if (!t) return;
  updateTabState(t.id, { projection: [], cursor: { kind: 'offset', offset: 0 }, pageIndex: 1 });
  void loadTabData(t.id);
}

function onPageSizeChange(e: Event): void {
  const t = tab.value;
  if (!t) return;
  const value = Number((e.target as HTMLSelectElement).value);
  // D20: a page-size change re-reads from offset 0.
  updateTabState(t.id, { pageSize: value, cursor: { kind: 'offset', offset: 0 }, pageIndex: 1 });
  void loadTabData(t.id);
}

function onPageInputEnter(): void {
  const t = tab.value;
  if (!t) return;
  const page = Number.parseInt(pageInput.value, 10);
  if (Number.isNaN(page) || page < 1) return;
  jumpToPage(t.id, page);
}

function onStop(): void {
  if (!running.value) return;
  void cancelOp(running.value);
}

const status = computed(() => {
  const t = tab.value;
  const v = view.value;
  if (!t) return '';
  const rows = t.runtime.rowsLoaded;
  const ms = t.runtime.elapsedMs;
  const cached = t.runtime.fromCache ? ' · cached' : '';
  const cancelled = t.runtime.status === 'error' && t.runtime.error?.includes('cancelled') ? ' · Cancelled' : '';
  return `${rows} rows · ${ms} ms${cached}${cancelled}`;
});

const emit = defineEmits<{ toggleFilter: [] }>();
</script>

<template>
  <div class="toolbar" data-testid="data-toolbar" :style="{ borderTopColor: color }">
    <div class="group">
      <button type="button" class="tool-button" title="First page" data-testid="page-first" @click="tab && pageFirst(tab.id)">
        <Codicon name="chevron-up" :size="12" class="rotate-180" />
      </button>
      <button type="button" class="tool-button" title="Previous page" data-testid="page-prev" @click="tab && pagePrev(tab.id)">
        <Codicon name="chevron-left" :size="12" />
      </button>
      <span class="pager" data-testid="pager">
        <span class="muted">page</span>
        <input
          :value="pageInput"
          type="number"
          min="1"
          class="page-input"
          data-testid="page-input"
          @change="onPageInputEnter"
        />
        <span v-if="totalPages !== null" class="muted" data-testid="page-total">of {{ totalPages }}</span>
      </span>
      <button type="button" class="tool-button" title="Next page" data-testid="page-next" @click="tab && pageNext(tab.id)">
        <Codicon name="chevron-right" :size="12" />
      </button>
      <button type="button" class="tool-button" title="Last page" :disabled="!canLast" data-testid="page-last" @click="tab && pageLast(tab.id)">
        <Codicon name="chevron-down" :size="12" class="rotate-180" />
      </button>
    </div>

    <div class="group">
      <select class="page-size" :value="tab?.state.pageSize ?? 500" data-testid="page-size" @change="onPageSizeChange">
        <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }}</option>
      </select>
      <button type="button" class="tool-button" title="Refresh" data-testid="refresh" @click="tab && loadTabData(tab.id, { refresh: true })">
        <Codicon name="refresh" :size="13" />
      </button>
      <button type="button" class="tool-button" title="Count all rows" data-testid="count-all" @click="tab && countAll(tab.id)">
        <Codicon name="list-ordered" :size="13" />
      </button>
      <button
        type="button"
        class="tool-button"
        title="Stop"
        :disabled="!busy"
        data-testid="stop"
        @click="onStop"
      >
        <Codicon name="stop" :size="13" />
      </button>
    </div>

    <div class="group projection" :class="{ open: projectionOpen }">
      <button type="button" class="tool-button" title="Columns (projection)" data-testid="projection-toggle" @click="projectionOpen = !projectionOpen">
        <Codicon name="columns-view" :size="13" />
      </button>
      <div v-if="projectionOpen" class="projection-menu" data-testid="projection-menu">
        <div class="projection-actions">
          <button type="button" class="mini" @click="setProjectionAll">All</button>
          <button type="button" class="mini" @click="setProjectionNone">None</button>
        </div>
        <label v-for="col in allColumns" :key="col" class="projection-item">
          <input
            type="checkbox"
            :checked="tab?.state.projection === null || (tab?.state.projection ?? []).includes(col)"
            @change="toggleProjection(col)"
          />
          <span>{{ col }}</span>
        </label>
      </div>
    </div>

    <div class="spacer" />
    <span class="status" data-testid="toolbar-status">{{ status }}</span>
    <button type="button" class="tool-button filter-toggle" title="Filter toolbar (⌘⇧F)" data-testid="filter-toggle" @click="emit('toggleFilter')">
      <Codicon name="filter" :size="13" />
    </button>

    <div v-if="showProgress" class="progress" data-testid="read-progress" />
  </div>
</template>

<style scoped>
.toolbar {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-top: 2px solid transparent;
  background: var(--kira-bg-chrome);
  overflow: visible;
}

.group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tool-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--kira-radius);
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.tool-button:hover:not(:disabled) {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.tool-button:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.pager {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.muted {
  color: var(--kira-fg-muted);
}

.page-input {
  width: 48px;
  height: 20px;
  padding: 0 4px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-size: 12px;
  text-align: center;
  outline: none;
}

.page-size {
  height: 20px;
  padding: 0 4px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-size: 12px;
}

.rotate-180 {
  transform: rotate(180deg);
}

.spacer {
  flex: 1;
}

.status {
  font-size: 11px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.projection {
  position: relative;
}

.projection-menu {
  position: absolute;
  top: 26px;
  left: 0;
  z-index: 50;
  min-width: 180px;
  max-height: 320px;
  overflow: auto;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 4px;
  display: flex;
  flex-direction: column;
}

.projection-actions {
  display: flex;
  gap: 4px;
  padding: 2px 4px 6px;
  border-bottom: 1px solid var(--kira-border);
  margin-bottom: 4px;
}

.mini {
  flex: 1;
  height: 20px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 11px;
  cursor: pointer;
}

.projection-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--kira-fg);
  cursor: pointer;
}

.projection-item:hover {
  background: var(--kira-hover);
}

.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--kira-accent);
  opacity: 0.7;
  animation: kira-indeterminate 1.2s ease-in-out infinite;
}

@keyframes kira-indeterminate {
  0% {
    transform: scaleX(0);
    transform-origin: left;
  }
  50% {
    transform: scaleX(1);
    transform-origin: left;
  }
  50.1% {
    transform-origin: right;
  }
  100% {
    transform: scaleX(0);
    transform-origin: right;
  }
}
</style>
