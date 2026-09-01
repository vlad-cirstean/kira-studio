<script setup lang="ts">
import type { DataTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openGenerateDataDialog } from '../../state/fakeData';
import { connColorVar } from '../../theme/connColor';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { ancestorPathPrefix } from '../shared/targetPath';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import DataGrid from './DataGrid.vue';
import DataToolbar from './DataToolbar.vue';
import FilterToolbar from './FilterToolbar.vue';
import PreviewCommandPanel from './PreviewCommandPanel.vue';
import { commitPending, discardPending, hasPending, pendingFor } from './pendingChanges';
import { type Match, pageSearchApi } from './search';
import {
  load,
  reload,
  reloadAfterMutation,
  runtime,
  setActionError,
  setSearchOpen,
  stop,
  toggleSearchOpen,
} from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below
// fires fresh on every tab switch, which is what makes per-tab load-on-activate and scroll
// restore (DataGrid's own onMounted) work without a manual watcher.
const props = defineProps<{ tab: DataTabRecord }>();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);

const connRecord = computed(() => connectionRecord(props.tab.connectionId));

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

// P48 F20: shared with DocumentView.vue's own identical breadcrumb prefix.
const pathPrefix = computed(() => ancestorPathPrefix(props.tab.connectionId, props.tab.path));

// P24 D37: the grid was the one view whose header carried no facts at all — every sibling view
// (KeyValue has four badges, Definition two, Documents one) says more about what's on screen than
// this one did. Kind + column count + read-only state are always known the moment a tab opens;
// the row count is gated on rt.count existing at all (§7 forbids computing one automatically), so
// this badge appears only once the user has actually pressed Σ, never before.
const columnCount = computed(() => rt.value?.meta?.columns.length ?? null);
const isWritable = computed(() => !!caps.value?.writable && !connRecord.value?.readOnly);
const primaryKeyLabel = computed(() => {
  const names = rt.value?.meta?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? [];
  return names.length ? `PK ${names.join(', ')}` : null;
});

// P48 step 14: the pending-changes group moved here from DataToolbar.vue so it can land in
// ViewChrome's own #toolbar-end slot (after the chrome's automatic push, right before RunState) —
// a component mounted inside #toolbar cannot also render into a sibling named slot of its parent.
const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});
const tabHasPending = computed(() => hasPending(props.tab.id));
const pendingCount = computed(() => {
  const p = pendingFor(props.tab.id);
  if (!p) return 0;
  return p.edits.size + p.deletes.size + p.inserts.length;
});
const previewOpen = ref(false);

// P43 F5/D7: commitPending's own rejection (a constraint violation, a type error, a read-only
// refusal) used to be an unhandled promise rejection — no try/catch here and no async-aware
// @click. The staged set already survives a failure (clearPending only runs on success); what was
// missing was telling the user why.
async function onCommit(): Promise<void> {
  if (!props.tab.connectionId) return;
  try {
    await commitPending(props.tab.connectionId, props.tab.path, props.tab.id);
    setActionError(props.tab.id, null);
    await reloadAfterMutation(props.tab.id);
  } catch (err) {
    setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

function onDiscard(): void {
  discardPending(props.tab.id);
  // P43 F5/D7: a discard resolves the very staging that a prior actionError was about — an error
  // strip surviving it would be pointing at a change that no longer exists.
  setActionError(props.tab.id, null);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.tab.id));
}
function onStop(): void {
  stop(props.tab.id);
}

// P15 D1/D11: the palette's own gate — mirrors DataToolbar.vue's canGenerateData exactly, since
// the palette entry has no disabled-button affordance to lean on.
function onGenerateData(): void {
  if (!caps.value?.tabular || !caps.value?.canInsert || connRecord.value?.readOnly) return;
  openGenerateDataDialog(props.tab.id);
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
    registerCommand('view.find', () => toggleSearchOpen(props.tab.id)),
    // Item 4 (regression pass, task batch P46-4): this used to call reload() directly, a doomed
    // no-op while the tab sits behind the reconnect gate (same bug the toolbar's own Refresh
    // button had, item 4's first pass) — the keyboard-shortcut/command-palette path needs the
    // same reconnect-or-refresh semantics as the visible button, not a second, unguarded one.
    registerCommand('view.refresh', () => onRefresh()),
    registerCommand('data.generate', onGenerateData),
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
  setSearchOpen(props.tab.id, false);
}
</script>

<template>
  <div class="data-view">
    <ViewChrome
      :tab="tab"
      :icon="targetIcon"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="grid-target"
      refresh-testid="toolbar-refresh"
      stop-testid="toolbar-stop"
      toolbar-testid="data-toolbar"
      toolbar2-testid="filter-toolbar"
      :can-refresh="!rt?.opId"
      :can-stop="!!rt?.opId"
      @refresh="onRefresh"
      @stop="onStop"
    >
      <template #badges>
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
      </template>
      <template #head-trailing>
        <span v-if="primaryKeyLabel" class="p-chip info" data-testid="grid-pk-chip">{{
          primaryKeyLabel
        }}</span>
      </template>

      <template #toolbar>
        <DataToolbar :tab="tab" />
      </template>

      <!-- FIX-3: pending edits as a count with both actions beside it — Commit is the only
           accent-filled control on the whole screen. The preview-command eye sits in this same
           group (only ever relevant while there is something pending to preview). ViewChrome
           itself already wraps #toolbar-end in a `.group` div — no second one needed here. -->
      <template #toolbar-end>
        <template v-if="tabHasPending">
          <span class="p-chip warn"
            >{{ pendingCount }} row{{ pendingCount === 1 ? '' : 's' }} pending</span
          >
          <div class="preview-anchor">
            <IconButton
              icon="eye"
              data-testid="toolbar-preview-command"
              :disabled="!isWritable"
              v-tooltip="isWritable ? 'Preview the SQL for pending changes' : 'Connection is read-only'"
              @click="previewOpen = !previewOpen"
            />
            <PreviewCommandPanel v-if="previewOpen" :tab-id="tab.id" @close="previewOpen = false" />
          </div>
          <IconButton
            icon="discard"
            data-testid="toolbar-discard-changes"
            :disabled="!isWritable"
            v-tooltip="'Discard pending changes'"
            @click="onDiscard"
          />
          <IconButton
            icon="save"
            tone="primary"
            data-testid="toolbar-commit-changes"
            :disabled="!isWritable"
            v-tooltip="'Commit pending changes'"
            @click="onCommit"
          />
        </template>
      </template>

      <template #toolbar-2>
        <FilterToolbar :tab="tab" />
      </template>

      <template #strips>
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
      </template>

      <ReconnectGate
        v-if="needsReconnect"
        container-testid="reconnect-panel"
        button-testid="reconnect-load"
        @reconnect="onReconnectAndLoad"
      />
      <template v-else>
        <!-- P16 design system LAW: work-in-progress is the ring + elapsed time beside the button
             that started it (ViewChrome's own RunState), never a bar across the top of the view —
             §8.5's "never a spinner that replaces the previous page" still holds, it just no
             longer needs a bar of its own to say so. -->
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
    </ViewChrome>
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

.error-strip {
  font-family: var(--kira-font-family);
  white-space: pre-wrap;
}

.grid-area {
  flex: 1;
  min-height: 0;
  position: relative;
}

.preview-anchor {
  position: relative;
}
</style>
