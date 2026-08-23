<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import { connColorVar } from '../../theme/connColor';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Strip from '../../theme/primitives/Strip.vue';
import ViewHeader from '../../theme/primitives/ViewHeader.vue';
import DataGrid from './DataGrid.vue';
import DataToolbar from './DataToolbar.vue';
import FilterToolbar from './FilterToolbar.vue';
import SearchToolbar from './SearchToolbar.vue';
import { load, reload, runtime } from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below
// fires fresh on every tab switch, which is what makes per-tab load-on-activate and scroll
// restore (DataGrid's own onMounted) work without a manual watcher.
const props = defineProps<{ tab: TabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4: a restored tab shows only this button until pressed — nothing loads automatically.
const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

const rt = computed(() => runtime[props.tab.id]);

const connectionRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);

// P16 design system LAW: the connection colour caps the toolbar as a 2px rail, never a tint on
// the whole view. Moved here from the shell-level Toolbar.vue this component's toolbars used to
// be rendered by (see DataToolbar.vue/FilterToolbar.vue — they render their own .p-toolbar bands
// unchanged, only who mounts them changed).
const railStyle = computed(() => ({ '--kira-rail': connColorVar(connectionRecord.value?.color) }));

const iconColor = computed(
  () => connColorVar(connectionRecord.value?.color) ?? 'var(--kira-fg-muted)',
);

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
// same as Documents/KeyValue/Stream/Console/Ddl — the grid mockup (Main.html) opened straight on
// its toolbar with no view-head, but that leaves the grid as the one view that doesn't say which
// connection/engine a tab belongs to at a glance.
const pathPrefix = computed(() => {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return '';
  const connectionName = connectionRecord.value?.name;
  const segments = decodePath(connectionId, props.tab.path).segments;
  const parts = [connectionName, ...segments.slice(0, -1).map((s) => s.name)].filter(
    (p): p is string => !!p,
  );
  return parts.length ? `${parts.join(' / ')} / ` : '';
});

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

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

function onGoToMatch(row: number, col: number): void {
  dataGridRef.value?.scrollCellIntoView(row, col);
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
      :conn-color="connectionRecord?.color ?? null"
      :conn-kind="connectionRecord?.kind"
      target-testid="grid-target"
    />
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
      <Strip
        v-if="rt?.status === 'error' && rt.error"
        tone="err"
        icon="warning"
        data-testid="error-strip"
        class="error-strip"
      >
        <span>{{ rt.error.message }}</span>
      </Strip>
      <div class="grid-area">
        <DataGrid ref="dataGridRef" :tab-id="tab.id" />
      </div>
    </template>
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
