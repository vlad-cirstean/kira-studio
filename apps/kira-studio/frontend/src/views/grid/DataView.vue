<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Empty } from '@theme/components/ui/empty';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@theme/components/ui/resizable';
import { connColorVar } from '@theme/connColor';
import RunState from '@theme/RunState.vue';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { registerCommand } from '@workbench/shortcuts/commands';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useCellSelectionStore } from '../../state/cellSelection';
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
const cellSelectionStore = useCellSelectionStore();
const props = defineProps<{ tab: DataTabRecord }>();

// P104/I2-39: CellEditorDock.vue is now a plain ResizablePanel (its own header comment) — the
// resize handle beside it must be this view's own direct ResizablePanelGroup child, gated on
// the same condition CellEditorDock's own `v-if` uses, or the handle would sit next to nothing.
const hasCellDock = computed(() => cellSelectionStore.selectedCellFor(props.tab.id) !== null);

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
const previewAnchorRef = ref<HTMLElement | null>(null);

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
  // F1 (P108 Part 10): also the same pending-changes lockout — Generate Data's own reload would
  // clear this tab's staged edits, same as DataToolbar.vue's button.
  if (
    !canGenerateDataFor(caps.value, connRecord.value?.readOnly) ||
    rt.value?.maskPreview ||
    pendingChangesStore.hasPending(props.tab.id)
  )
    return;
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
  <div class="h-full flex flex-col min-h-0">
    <ViewToolbar data-testid="view-head">
      <span v-if="railColor !== undefined" class="size-1.25 rounded-full shrink-0" :class="!railColor ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'" data-testid="conn-dot" :style="{ '--kira-rail': connColorVar(railColor) }" />
      <span v-if="connRecord?.kind" class="size-4 flex items-center justify-center shrink-0"><EngineIcon :kind="connRecord.kind" :size="13" /></span>
      <span class="size-4 flex items-center justify-center shrink-0" :style="{ color: iconColor }"><CodiconIcon :name="targetIcon" :size="13" /></span>
      <span class="text-kira-md text-fg truncate" data-testid="grid-target">
        <span v-if="pathPrefix" class="text-subtle">{{ pathPrefix }}</span>{{ targetTail?.name ?? tab.path }}
      </span>
      <Badge v-if="targetTail?.kind" data-testid="grid-kind-badge">{{ targetTail.kind }}</Badge>
      <Badge v-if="columnCount !== null" data-testid="grid-column-count-badge"
        >{{ columnCount }} columns</Badge
      >
      <Badge data-testid="grid-writable-badge">{{
        effectivelyWritable ? 'read-write' : 'read-only'
      }}</Badge>
      <Badge v-if="rt?.count" data-testid="grid-row-count-badge"
        >Σ {{ rt.count.value.toLocaleString() }} rows</Badge
      >
      <span class="ml-auto flex items-center gap-1">
        <Badge v-if="primaryKeyLabel" variant="info" data-testid="grid-pk-chip">{{ primaryKeyLabel }}</Badge>
      </span>
    </ViewToolbar>

    <div
      class="h-0.5 shrink-0 bg-(--kira-rail)"
      data-testid="toolbar-rail"
      :style="{ '--kira-rail': connColorVar(railColor) }"
    />
    <ViewToolbar data-testid="data-toolbar">
      <div class="flex items-center gap-1.5 min-w-0">
        <TooltipIconButton
          icon="refresh"
          label="Refresh"
          disabled-trigger
          data-testid="toolbar-refresh"
          :disabled="!!rt?.opId"
          @click="onRefresh"
        />
        <TooltipIconButton
          icon="debug-stop"
          label="Stop"
          disabled-trigger
          :class="{ 'text-error': !!rt?.opId }"
          data-testid="toolbar-stop"
          :disabled="!rt?.opId"
          @click="onStop"
        />
      </div>
      <DataToolbar :tab="tab" />
      <span class="ml-auto" />
      <RunState :state="runState" />
      <!-- FIX-3: pending edits as a count with both actions beside it — Commit is the only
           accent-filled control on the whole screen. The preview-command eye sits in this same
           group. -->
      <div class="flex items-center gap-1.5 min-w-0">
        <template v-if="tabHasPending">
          <Badge variant="warn" data-testid="pending-count-chip"
            >{{ pendingCount }} row{{ pendingCount === 1 ? '' : 's' }} pending</Badge
          >
          <Popover :open="previewOpen" @update:open="previewOpen = $event">
            <div ref="previewAnchorRef" class="relative">
              <TooltipIconButton
                icon="eye"
                :label="isWritable ? 'Preview the SQL for pending changes' : 'Connection is read-only'"
                aria-label="Preview the SQL for pending changes"
                disabled-trigger
                data-testid="toolbar-preview-command"
                :disabled="!isWritable"
                @click="previewOpen = !previewOpen"
              />
              <PopoverAnchor :reference="previewAnchorRef ?? undefined" />
            </div>
            <PreviewCommandPanel v-if="previewOpen" :tab-id="tab.id" @close="previewOpen = false" />
          </Popover>
          <TooltipIconButton
            icon="discard"
            label="Discard pending changes"
            disabled-trigger
            data-testid="toolbar-discard-changes"
            :disabled="!isWritable"
            @click="onDiscard"
          />
          <TooltipIconButton
            icon="save"
            label="Commit pending changes"
            disabled-trigger
            variant="toolbar-primary"
            data-testid="toolbar-commit-changes"
            :disabled="!isWritable"
            @click="onCommit"
          />
        </template>
      </div>
    </ViewToolbar>
    <ViewToolbar border="none" data-testid="filter-toolbar">
      <FilterToolbar :tab="tab" />
    </ViewToolbar>

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

    <ResizablePanelGroup direction="vertical" class="flex-1 min-h-0">
      <ResizablePanel class="flex flex-col min-h-0" :order="1">
        <Empty v-if="needsReconnect" data-testid="reconnect-panel">
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="reconnect-load"
            @click="onReconnectAndLoad"
          >
            Reconnect & load
          </Button>
        </Empty>
        <template v-else>
          <!-- P16 design system LAW: work-in-progress is the ring + elapsed time beside the button
               that started it (RunState, above), never a bar across the top of the view — §8.5's
               "never a spinner that replaces the previous page" still holds, it just no longer needs a
               bar of its own to say so. -->
          <Alert
            v-if="rt?.status === 'error' && rt.error"
            variant="destructive"
            data-testid="error-strip"
            class="whitespace-pre-wrap font-data"
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
            class="whitespace-pre-wrap font-data"
          >
            <CodiconIcon name="warning" :size="16" />
            <AlertDescription>{{ rt.actionError }}</AlertDescription>
          </Alert>
          <!-- M5 §6.4: the one place this view states, in prose, that what's on screen is not the
               stored data — a preview convenience (§6.1), not the security boundary, but a user
               switching tabs or taking a screenshot must not mistake a bucket string for a literal
               value. -->
          <Alert v-if="rt?.maskPreview" variant="note" data-testid="mask-preview-strip">
            <CodiconIcon name="eye-closed" :size="16" />
            <AlertDescription>
              Values shown are masked for this preview — not the stored data. Editing is off while it's on.
            </AlertDescription>
          </Alert>
          <!-- F1 (P108 Part 10): a sibling tab committed on this same table while this tab had
               pending changes staged — the fan-out marked this page stale instead of reloading it,
               to protect the staged edits. Commit or discard resolves it; Refresh then updates the
               page and clears this. -->
          <Alert v-if="rt?.pageStale" variant="note" data-testid="page-stale-strip">
            <CodiconIcon name="sync" :size="16" />
            <AlertDescription>
              Another tab committed changes to this table. Commit or discard pending changes, then
              refresh to see them.
            </AlertDescription>
          </Alert>
          <div class="flex-1 min-h-0 relative">
            <SlickGridHost ref="dataGridRef" :tab-id="tab.id" />
          </div>
        </template>
      </ResizablePanel>
      <!-- P110 B32: the divider styling itself moved into ResizableHandle.vue's own shared
           component -- `.cell-splitter` is a bare marker class, kept only because
           cell-editor.spec.ts polls its box-shadow via getComputedStyle (no rule of its own
           attaches to the name any more). -->
      <ResizableHandle v-if="hasCellDock" class="cell-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />
      <CellEditorDock :tab-id="tab.id" />
    </ResizablePanelGroup>
  </div>
</template>
