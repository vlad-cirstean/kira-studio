<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { registerCommand } from '@workbench/shortcuts/commands';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useConnectionsStore } from '../../state/connections';
import { useFakeDataStore } from '../../state/fakeData';
import { useRunState } from '../../state/runState';
import type { DataTabRecord } from '../../state/tabDomain';
import EngineIcon from '../../theme/EngineIcon.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { ancestorPathPrefix } from '../shared/targetPath';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import DataToolbar from './DataToolbar.vue';
import FilterToolbar from './FilterToolbar.vue';
import { canGenerateDataFor } from './fakeData/generate';
import PreviewCommandPanel from './PreviewCommandPanel.vue';
import { usePendingChangesStore } from './pendingChanges';
import SlickGridHost from './SlickGridHost.vue';
import { type Match, pageSearchApi } from './search';
import { useGridViewStore } from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below
// fires fresh on every tab switch, which is what makes per-tab load-on-activate and scroll
// restore (SlickGridHost's own onMounted) work without a manual watcher.
const fakeDataStore = useFakeDataStore();
const pendingChangesStore = usePendingChangesStore();
const connectionsStore = useConnectionsStore();
const gridViewStore = useGridViewStore();
const props = defineProps<{ tab: DataTabRecord }>();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => gridViewStore.load(props.tab.id),
);

const rt = computed(() => gridViewStore.runtime[props.tab.id]);

const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));

const iconColor = computed(() => connColorVar(connRecord.value?.color) ?? 'var(--kira-fg-muted)');

// P104 §3: ViewChrome/ViewHeader/RunState inlined at this call site (no library counterpart).
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});

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
// M5 §6.4: the grid-writable-badge's own reason — masked reads as read-only, since it is (the
// preview toggle can't be on while anything is pending, so this never has to distinguish "masked
// but would otherwise be writable" from "genuinely read-only" for the badge's one-word purpose).
const effectivelyWritable = computed(() => isWritable.value && !rt.value?.maskPreview);
const primaryKeyLabel = computed(() => {
  const names = rt.value?.meta?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? [];
  return names.length ? `PK ${names.join(', ')}` : null;
});

// P48 step 14: the pending-changes group moved here from DataToolbar.vue so it can land in
// ViewChrome's own #toolbar-end slot (after the chrome's automatic push and, since P22 D4,
// RunState too) — a component mounted inside #toolbar cannot also render into a sibling named
// slot of its parent.
const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsStore.states[connectionId]?.caps ?? null) : null;
});
const tabHasPending = computed(() => pendingChangesStore.hasPending(props.tab.id));
const pendingCount = computed(() => {
  const p = pendingChangesStore.pendingFor(props.tab.id);
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
    await pendingChangesStore.commitPending(props.tab.connectionId, props.tab.path, props.tab.id);
    gridViewStore.setActionError(props.tab.id, null);
    await gridViewStore.reloadAfterMutation(props.tab.id);
  } catch (err) {
    gridViewStore.setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

function onDiscard(): void {
  pendingChangesStore.discardPending(props.tab.id);
  // P43 F5/D7: a discard resolves the very staging that a prior actionError was about — an error
  // strip surviving it would be pointing at a change that no longer exists.
  gridViewStore.setActionError(props.tab.id, null);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => gridViewStore.reload(props.tab.id));
}
function onStop(): void {
  gridViewStore.stop(props.tab.id);
}

// P15 D1/D11: the palette's own gate, since the palette entry has no disabled-button affordance
// to lean on — shares canGenerateDataFor with DataToolbar.vue's own button (P12 round 1 F16) so
// the two can't drift apart the way this file's own predicate once did.
function onGenerateData(): void {
  // M5 §6.4: the same lockout DataToolbar.vue's own Generate button applies — this is the
  // command-palette/keyboard-shortcut path to the identical action, and must not bypass it.
  if (!canGenerateDataFor(caps.value, connRecord.value?.readOnly) || rt.value?.maskPreview) return;
  fakeDataStore.openGenerateDataDialog(props.tab.id);
}

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  if (!needsReconnect.value && !gridViewStore.runtime[props.tab.id]) {
    void gridViewStore.load(props.tab.id);
  }
  // D11: this component is mounted only while its tab is the active one (MainView.vue's
  // `v-else-if` chain), so registering here — rather than switching on tab kind in a global
  // dispatcher — is what makes Find/Refresh always act on the currently visible data tab.
  unregisterCommands = [
    registerCommand('view.find', () => gridViewStore.toggleSearchOpen(props.tab.id)),
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
  gridViewStore.setSearchOpen(props.tab.id, false);
}
</script>

<template>
  <div class="data-view">
    <div class="p-view-head">
      <span v-if="railColor !== undefined" class="p-conn-dot" :class="{ none: !railColor }" :style="{ '--kira-rail': connColorVar(railColor) }" />
      <span v-if="connRecord?.kind" class="icon-box"><EngineIcon :kind="connRecord.kind" :size="13" /></span>
      <span class="icon-box" :style="{ color: iconColor }"><CodiconIcon :name="targetIcon" :size="13" /></span>
      <span class="p-view-target" data-testid="grid-target">
        <span v-if="pathPrefix" class="path">{{ pathPrefix }}</span>{{ targetTail?.name ?? tab.path }}
      </span>
      <span v-if="targetTail?.kind" class="p-badge" data-testid="grid-kind-badge">{{ targetTail.kind }}</span>
      <span v-if="columnCount !== null" class="p-badge" data-testid="grid-column-count-badge"
        >{{ columnCount }} columns</span
      >
      <span class="p-badge" data-testid="grid-writable-badge">{{
        effectivelyWritable ? 'read-write' : 'read-only'
      }}</span>
      <span v-if="rt?.count" class="p-badge" data-testid="grid-row-count-badge"
        >Σ {{ rt.count.value.toLocaleString() }} rows</span
      >
      <span class="p-push flex items-center gap-1">
        <span v-if="primaryKeyLabel" class="p-chip info" data-testid="grid-pk-chip">{{ primaryKeyLabel }}</span>
      </span>
    </div>

    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar" data-testid="data-toolbar">
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="toolbar-refresh"
                :disabled="!!rt?.opId"
                aria-label="Refresh"
                @click="onRefresh"
              >
                <CodiconIcon name="refresh" :size="13" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
              <Button
                variant="toolbar"
                size="kira-icon"
                :class="{ 'text-error': !!rt?.opId }"
                data-testid="toolbar-stop"
                :disabled="!rt?.opId"
                aria-label="Stop"
                @click="onStop"
              >
                <CodiconIcon name="debug-stop" :size="13" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </div>
      <DataToolbar :tab="tab" />
      <span class="p-push" />
      <span
        class="p-run-state inline-flex items-center gap-1 font-[family-name:var(--kira-font-data)] text-kira-xs text-subtle"
        :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
      >
        <span class="label min-w-[7ch] text-right">{{ runStateLabel }}</span>
        <span
          class="ring h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-border-strong"
          :class="{
            'animate-[spin_0.7s_linear_infinite] border-t-primary border-r-transparent border-b-primary border-l-primary': runState.status === 'running',
            'border-error': runState.status === 'error',
          }"
        />
      </span>
      <!-- FIX-3: pending edits as a count with both actions beside it — Commit is the only
           accent-filled control on the whole screen. The preview-command eye sits in this same
           group. -->
      <div class="group">
        <template v-if="tabHasPending">
          <span class="p-chip warn"
            >{{ pendingCount }} row{{ pendingCount === 1 ? '' : 's' }} pending</span
          >
          <div class="preview-anchor">
            <Tooltip>
              <TooltipTrigger as-child>
                <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
                  <Button
                    variant="toolbar"
                    size="kira-icon"
                    data-testid="toolbar-preview-command"
                    :disabled="!isWritable"
                    aria-label="Preview the SQL for pending changes"
                    @click="previewOpen = !previewOpen"
                  >
                    <CodiconIcon name="eye" :size="13" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ isWritable ? 'Preview the SQL for pending changes' : 'Connection is read-only' }}</TooltipContent>
            </Tooltip>
            <PreviewCommandPanel v-if="previewOpen" :tab-id="tab.id" @close="previewOpen = false" />
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  data-testid="toolbar-discard-changes"
                  :disabled="!isWritable"
                  aria-label="Discard pending changes"
                  @click="onDiscard"
                >
                  <CodiconIcon name="discard" :size="13" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Discard pending changes</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
                <Button
                  variant="toolbar-primary"
                  size="kira-icon"
                  data-testid="toolbar-commit-changes"
                  :disabled="!isWritable"
                  aria-label="Commit pending changes"
                  @click="onCommit"
                >
                  <CodiconIcon name="save" :size="13" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Commit pending changes</TooltipContent>
          </Tooltip>
        </template>
      </div>
    </div>
    <div class="p-toolbar last" data-testid="filter-toolbar">
      <FilterToolbar :tab="tab" />
    </div>

    <!-- Below the filter row, not floating over the grid it searches — the "docks at the bottom
         of the result" placement from Toolbars.html overlapped the last visible row, which read as
         a bug rather than a search bar. -->
    <SearchToolbar
      v-if="rt?.searchOpen"
      :tab-id="tab.id"
      testid-prefix=""
      row-noun="rows"
      :api="pageSearchApi"
      :mask-preview-on="!!rt?.maskPreview"
      @go-to-match="onGoToMatch"
      @close="onCloseSearch"
    />

    <div
      v-if="needsReconnect"
      class="p-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-2 text-subtle"
      data-testid="reconnect-panel"
    >
      <Button
        variant="dialog-primary"
        size="kira-lg"
        data-testid="reconnect-load"
        @click="onReconnectAndLoad"
      >
        Reconnect & load
      </Button>
    </div>
    <template v-else>
      <!-- P16 design system LAW: work-in-progress is the ring + elapsed time beside the button
           that started it (RunState, above), never a bar across the top of the view — §8.5's
           "never a spinner that replaces the previous page" still holds, it just no longer needs a
           bar of its own to say so. -->
      <Alert
        v-if="rt?.status === 'error' && rt.error"
        variant="destructive"
        data-testid="error-strip"
        class="error-strip"
      >
        <CodiconIcon name="warning" :size="16" />
        <AlertDescription>{{ rt.error.message }}</AlertDescription>
      </Alert>
      <!-- P43 F5/D7: a failed commit, distinct from a failed load above — the grid is still
           showing a perfectly valid page, only the write was refused. -->
      <Alert
        v-if="rt?.actionError"
        variant="destructive"
        data-testid="data-action-error"
        class="error-strip"
      >
        <CodiconIcon name="warning" :size="16" />
        <AlertDescription>{{ rt.actionError }}</AlertDescription>
      </Alert>
      <!-- M5 §6.4: the one place this view states, in prose, that what's on screen is not the
           stored data — a preview convenience (§6.1), not the security boundary, but a user
           switching tabs or taking a screenshot must not mistake a bucket string for a literal
           value. -->
      <Alert v-if="rt?.maskPreview" class="strip-note" data-testid="mask-preview-strip">
        <CodiconIcon name="eye-closed" :size="16" />
        <AlertDescription class="strip-note-text">
          Values shown are masked for this preview — not the stored data. Editing is off while it's on.
        </AlertDescription>
      </Alert>
      <div class="grid-area">
        <SlickGridHost ref="dataGridRef" :tab-id="tab.id" />
      </div>
    </template>
    <CellEditorDock :tab-id="tab.id" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.data-view {
  @apply h-full flex flex-col min-h-0;
}

.error-strip {
  @apply whitespace-pre-wrap font-[family-name:var(--kira-font-data)];
}

.grid-area {
  @apply flex-1 min-h-0 relative;
}

.preview-anchor {
  @apply relative;
}

/* Alert tone class replacing MessageStrip's own note-tone color (P104 §9 rule 5: literal hex, not
   a --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-[#a8c8ee];
}
</style>
