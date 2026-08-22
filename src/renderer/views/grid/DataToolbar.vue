<script setup lang="ts">
import type { DataTabState } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { connectionsState } from '../../state/connections';
import { activeTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import ColumnsMenu from './ColumnsMenu.vue';
import {
  goFirst,
  goLast,
  goNext,
  goPrev,
  goToPage,
  reload,
  runCount,
  runtime,
  setPageSize,
  stop,
} from './state';

const PAGE_SIZES: DataTabState['pageSize'][] = [10, 100, 1000, 10000];
const PAGE_SIZE_LABEL: Record<DataTabState['pageSize'], string> = {
  10: '10',
  100: '100',
  1000: '1k',
  10000: '10k',
};

const tab = computed(() => activeTab.value);
const rt = computed(() => (tab.value ? runtime[tab.value.id] : undefined));

const caps = computed(() => {
  const connectionId = tab.value?.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

const pageDisplay = computed(() => (tab.value ? tab.value.state.pageIndex + 1 : 1));
const pageCount = computed(() => {
  const count = rt.value?.count;
  const size = tab.value?.state.pageSize;
  if (!count || !size) return null;
  return Math.max(1, Math.ceil(count.value / size));
});

function onRefresh(): void {
  if (tab.value) void reload(tab.value.id);
}
function onFirst(): void {
  if (tab.value) void goFirst(tab.value.id);
}
function onPrev(): void {
  if (tab.value) void goPrev(tab.value.id);
}
function onNext(): void {
  if (tab.value) void goNext(tab.value.id);
}
function onLast(): void {
  if (tab.value) void goLast(tab.value.id);
}
function onCount(): void {
  if (tab.value) void runCount(tab.value.id);
}
function onStop(): void {
  if (tab.value) stop(tab.value.id);
}
function onPageSize(size: DataTabState['pageSize']): void {
  if (tab.value) void setPageSize(tab.value.id, size);
}
function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (tab.value && Number.isFinite(value) && value >= 1) {
    void goToPage(tab.value.id, value - 1);
  }
}
function onToggleSearch(): void {
  const r = tab.value ? runtime[tab.value.id] : undefined;
  if (r) r.searchOpen = !r.searchOpen;
}

const columnsOpen = ref(false);
</script>

<template>
  <div v-if="tab" class="data-toolbar" data-testid="data-toolbar">
    <button type="button" title="Refresh" data-testid="toolbar-refresh" @click="onRefresh">
      <Codicon name="refresh" :size="14" />
    </button>

    <div class="pager" data-testid="pager" :data-pagination="rt?.lastStrategy">
      <button
        type="button"
        title="First page"
        data-testid="pager-first"
        :disabled="tab.state.pageIndex === 0"
        @click="onFirst"
      >
        <Codicon name="chevron-left" :size="12" />|
      </button>
      <button
        type="button"
        title="Previous page"
        data-testid="pager-prev"
        :disabled="tab.state.pageIndex === 0"
        @click="onPrev"
      >
        <Codicon name="chevron-left" :size="12" />
      </button>
      <span class="page-label">
        page
        <input
          type="number"
          min="1"
          class="page-input"
          data-testid="pager-page-input"
          :value="pageDisplay"
          @change="onJump"
        />
        <template v-if="pageCount"> of {{ pageCount }}</template>
      </span>
      <button
        type="button"
        title="Next page"
        data-testid="pager-next"
        :disabled="!rt?.hasMore"
        @click="onNext"
      >
        <Codicon name="chevron-right" :size="12" />
      </button>
      <button
        type="button"
        :title="pageCount ? 'Last page' : 'Count rows first'"
        data-testid="pager-last"
        :disabled="!pageCount"
        @click="onLast"
      >
        |<Codicon name="chevron-right" :size="12" />
      </button>
    </div>

    <div class="segmented" data-testid="page-size-picker">
      <button
        v-for="size in PAGE_SIZES"
        :key="size"
        type="button"
        :class="{ active: tab.state.pageSize === size }"
        :data-testid="`page-size-${size}`"
        @click="onPageSize(size)"
      >
        {{ PAGE_SIZE_LABEL[size] }}
      </button>
    </div>

    <button
      type="button"
      class="count-button"
      data-testid="toolbar-count"
      :class="{ stale: rt?.count?.stale }"
      title="Count all"
      @click="onCount"
    >
      <span v-if="rt?.count">
        Σ {{ rt.count.value.toLocaleString() }}<span v-if="!rt.count.exact">~</span>
        <Codicon v-if="rt.count.stale" name="refresh" :size="11" />
      </span>
      <span v-else>Σ count all</span>
    </button>

    <div class="columns-anchor">
      <button type="button" data-testid="toolbar-columns" @click="columnsOpen = !columnsOpen">
        columns ▾
      </button>
      <ColumnsMenu
        v-if="columnsOpen"
        :tab-id="tab.id"
        :caps="caps"
        @close="columnsOpen = false"
      />
    </div>

    <button
      type="button"
      disabled
      title="Available in a later version"
      data-testid="toolbar-add-row"
    >
      + row
    </button>
    <button
      type="button"
      disabled
      title="Available in a later version"
      data-testid="toolbar-delete-row"
    >
      − row
    </button>
    <button
      type="button"
      disabled
      title="Available in a later version"
      data-testid="toolbar-preview-command"
    >
      ⌘ preview command
    </button>

    <button
      type="button"
      title="Search this page"
      data-testid="toolbar-search"
      @click="onToggleSearch"
    >
      <Codicon name="search" :size="14" />
    </button>

    <button
      type="button"
      title="Stop"
      data-testid="toolbar-stop"
      :disabled="!rt?.opId"
      @click="onStop"
    >
      <Codicon name="debug-stop" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.data-toolbar {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 12px;
}

.data-toolbar > button {
  display: flex;
  align-items: center;
  gap: 2px;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: var(--kira-radius-sm);
}

.data-toolbar > button:hover:not(:disabled) {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.data-toolbar > button:disabled {
  opacity: 0.4;
  cursor: default;
}

.pager {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pager button {
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 3px 4px;
  border-radius: var(--kira-radius-sm);
  font-size: 10px;
}

.pager button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.pager button:disabled {
  opacity: 0.4;
  cursor: default;
}

.page-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.page-input {
  width: 40px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  font-size: 11px;
  padding: 1px 4px;
}

.segmented {
  display: flex;
  gap: 2px;
}

.segmented button {
  padding: 2px 6px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
  font-size: 11px;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.count-button.stale {
  color: var(--kira-warn);
}

.columns-anchor {
  position: relative;
}
</style>
