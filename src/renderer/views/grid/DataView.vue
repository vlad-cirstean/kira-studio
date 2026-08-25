<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectionRecord } from '../../state/connections';
import { connColorVar } from '../../theme/connColor';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import ViewHeader from '../../theme/primitives/ViewHeader.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { useConnectionGate } from '../shared/useConnectionGate';
import DataGrid from './DataGrid.vue';
import DataToolbar from './DataToolbar.vue';
import FilterToolbar from './FilterToolbar.vue';
import { type Match, pageSearchApi } from './search';
import { load, reload, runtime } from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below
// fires fresh on every tab switch, which is what makes per-tab load-on-activate and scroll
// restore (DataGrid's own onMounted) work without a manual watcher.
const props = defineProps<{ tab: TabRecord }>();

const { connectionStatus, needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);

const connRecord = computed(() => connectionRecord(props.tab.connectionId));

// P16 design system LAW: the connection colour caps the toolbar as a 2px rail, never a tint on
// the whole view. Moved here from the shell-level Toolbar.vue this component's toolbars used to
// be rendered by (see DataToolbar.vue/FilterToolbar.vue — they render their own .p-toolbar bands
// unchanged, only who mounts them changed).
const railStyle = computed(() => ({ '--kira-rail': connColorVar(connRecord.value?.color) }));

const iconColor = computed(() => connColorVar(connRecord.value?.color) ?? 'var(--kira-fg-muted)');

const targetTail = computed(() => pathTail(props.tab.path));

const KIND_ICON: Record<string, string> = {
  table: 'table',
  view: 'eye',
  matview: 'symbol-structure',
};
const targetIcon = computed(() => {
  const kind = targetTail.value?.kind;
  return (kind && KIND_ICON[kind]) || 'table';
});

// Every data view's crumbar starts with the connection's engine icon (ViewHeader's connKind),
// same as Documents/KeyValue/Stream/Console/Definition — the grid mockup (Main.html) opened straight on
// its toolbar with no view-head, but that leaves the grid as the one view that doesn't say which
// connection/engine a tab belongs to at a glance.
const pathPrefix = computed(() => {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return '';
  const connectionName = connRecord.value?.name;
  const segments = decodePath(connectionId, props.tab.path).segments;
  const parts = [connectionName, ...segments.slice(0, -1).map((s) => s.name)].filter(
    (p): p is string => !!p,
  );
  return parts.length ? `${parts.join(' / ')} / ` : '';
});

// P24 D37: the grid was the one view whose header carried no facts at all — every sibling view
// (KeyValue has four badges, Definition two, Documents one) says more about what's on screen than
// this one did. Kind + column count + read-only state are always known the moment a tab opens;
// the row count is gated on rt.count existing at all (§7 forbids computing one automatically), so
// this badge appears only once the user has actually pressed Σ, never before.
const columnCount = computed(() => rt.value?.meta?.columns.length ?? null);
const isWritable = computed(() => !connRecord.value?.readOnly);
const primaryKeyLabel = computed(() => {
  const names = rt.value?.meta?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? [];
  return names.length ? `PK ${names.join(', ')}` : null;
});

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  // D11: this component is mounted only while its tab is the active one (MainView.vue's
  // `v-else-if` chain), so registering here — rather than switching on tab kind in a global
  // dispatcher — is what makes Find/Refresh always act on the currently visible data tab.
  unregisterCommands = [
    registerCommand('view.find', () => {
      const rt = runtime[props.tab.id];
      if (rt) rt.searchOpen = !rt.searchOpen;
    }),
    registerCommand('view.refresh', () => void reload(props.tab.id)),
  ];
});

onUnmounted(() => {
  for (const off of unregisterCommands) off();
});

const dataGridRef = ref<{ scrollCellIntoView: (row: number, col: number) => void } | null>(null);

function onGoToMatch(match: Match): void {
  dataGridRef.value?.scrollCellIntoView(match.row, match.col);
}
function onCloseSearch(): void {
  const runtimeEntry = runtime[props.tab.id];
  if (runtimeEntry) runtimeEntry.searchOpen = false;
}
</script>

<template>
  <div class="data-view">
    <ViewHeader
      :icon="targetIcon"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      :conn-color="connRecord?.color ?? null"
      :conn-kind="connRecord?.kind"
      target-testid="grid-target"
    >
      <span v-if="targetTail?.kind" class="p-badge" data-testid="grid-kind-badge">{{
        targetTail.kind
      }}</span>
      <span v-if="columnCount !== null" class="p-badge" data-testid="grid-column-count-badge"
        >{{ columnCount }} columns</span
      >
      <span class="p-badge" data-testid="grid-writable-badge">{{
        isWritable ? 'read-write' : 'read-only'
      }}</span>
      <span v-if="rt?.count" class="p-badge" data-testid="grid-row-count-badge"
        >Σ {{ rt.count.value.toLocaleString() }} rows</span
      >
      <template #trailing>
        <span v-if="primaryKeyLabel" class="p-chip info" data-testid="grid-pk-chip">{{
          primaryKeyLabel
        }}</span>
      </template>
    </ViewHeader>
    <!-- DataToolbar and FilterToolbar render their own .p-toolbar bands unchanged; this is just
         their new host, moved from the shell-level Toolbar.vue so every view's chrome lives
         inside the view. -->
    <div class="toolbar-band" :style="railStyle">
      <div class="p-toolbar-rail" :style="railStyle" />
      <DataToolbar />
      <FilterToolbar />
      <!-- Below the filter row, not floating over the grid it searches — the "docks at the
           bottom of the result" placement from Toolbars.html overlapped the last visible row,
           which read as a bug rather than a search bar. -->
      <SearchToolbar
        v-if="rt?.searchOpen"
        :tab-id="tab.id"
        testid-prefix=""
        row-noun="rows"
        :api="pageSearchApi"
        @go-to-match="onGoToMatch"
        @close="onCloseSearch"
      />
    </div>
    <ReconnectGate
      v-if="needsReconnect"
      container-testid="reconnect-panel"
      button-testid="reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <template v-else>
      <!-- P16 design system LAW: work-in-progress is the ring + elapsed time beside the button
           that started it (DataToolbar's p-run-state), never a bar across the top of the view —
           §8.5's "never a spinner that replaces the previous page" still holds, it just no longer
           needs a bar of its own to say so. -->
      <MessageStrip
        v-if="rt?.status === 'error' && rt.error"
        tone="err"
        icon="warning"
        data-testid="error-strip"
        class="error-strip"
      >
        <span>{{ rt.error.message }}</span>
      </MessageStrip>
      <!-- P43 F5/D7: a failed commit, distinct from a failed load above — the grid is still
           showing a perfectly valid page, only the write was refused. -->
      <MessageStrip
        v-if="rt?.actionError"
        tone="err"
        icon="warning"
        data-testid="data-action-error"
        class="error-strip"
      >
        <span>{{ rt.actionError }}</span>
      </MessageStrip>
      <div class="grid-area">
        <DataGrid ref="dataGridRef" :tab-id="tab.id" />
      </div>
    </template>
    <CellEditorDock :tab-id="tab.id" />
  </div>
</template>

<style scoped>
.data-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toolbar-band {
  min-height: 32px;
  flex-shrink: 0;
}

.error-strip {
  font-family: var(--kira-font-family);
  white-space: pre-wrap;
}

.grid-area {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
