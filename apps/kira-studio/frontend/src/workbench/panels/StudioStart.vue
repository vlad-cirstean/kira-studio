<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { connColorVar } from '@theme/connColor';
import { formatRelative } from '@workbench/util/format';
import { computed } from 'vue';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import { useDatagripImportStore } from '../../state/datagripImport';
import { type RecentTableEntry, useRecentTablesStore, useTabsStore } from '../../state/tabs';

// P1 C4: Studio's two empty states, extracted verbatim out of MainView.vue's old dispatch
// chain (F9) — the mode's own "nothing open" content, mirroring api/ApiStart.vue (C6).

// P16 design system's FirstRun.html: one door, no vestibule. The engine grid lives only in
// the New connection dialog, never repeated at the top level.
const datagripImportStore = useDatagripImportStore();
const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();
const recentTablesStore = useRecentTablesStore();
const tabsStore = useTabsStore();

const hasConnections = computed(() => connectionsStore.records.length > 0);

function connectionFor(entry: RecentTableEntry) {
  return connectionsStore.connectionRecord(entry.connectionId);
}

function iconFor(entry: RecentTableEntry): string {
  if (entry.kind === 'document') return 'json';
  // P17: a 'keyvalue' entry is a redis key OR an s3 object — same pathTail-kind check
  // TabStrip.vue's own iconFor makes for the live tab icon.
  if (entry.kind === 'keyvalue')
    return pathTail(entry.path)?.kind === 'object' ? 'file' : 'symbol-key';
  if (entry.kind === 'stream') return 'broadcast';
  return 'table';
}

function iconColorFor(entry: RecentTableEntry): string {
  if (entry.kind === 'document') {
    return connColorVar(connectionFor(entry)?.color) ?? 'var(--kira-fg-muted)';
  }
  return 'var(--kira-info)';
}

function openRecent(entry: RecentTableEntry): void {
  if (entry.kind === 'data') tabsStore.openDataTab(entry.connectionId, entry.path);
  else if (entry.kind === 'document') tabsStore.openDocumentTab(entry.connectionId, entry.path);
  else if (entry.kind === 'keyvalue') tabsStore.openKeyValueTab(entry.connectionId, entry.path);
  else tabsStore.openStreamTab(entry.connectionId, entry.path);
}
</script>

<template>
  <!-- FirstRun.html — no connections at all: one button, no duplicate engine grid. -->
  <div v-if="!hasConnections" class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="first-run">
    <div class="w-96 flex flex-col items-center text-center gap-4">
      <span class="start-mark text-subtle"><CodiconIcon name="database" :size="32" /></span>
      <!-- P24 D31: no bold text anywhere in the app -- --kira-t-xl (text-kira-xl, the scale's
           largest step) already carries the emphasis a first-run heading needs. -->
      <div class="tracking-normal text-kira-xl text-fg">No connections yet</div>
      <div class="mt-0 text-kira-md leading-normal text-muted-foreground">
        Kira Studio needs somewhere to connect before it can show you anything.
      </div>
      <!-- P110 B26: --kira-s-2 (4px) -> gap-1 is a real, quantified mismatch against
           dialog/kira-lg's own gap-1.5 (6px) -- kept as a class override rather than a new Button
           size, since only these two call sites need it. Padding/height/border/background/colour
           all already match dialog/dialog-primary + kira-lg exactly (both pre-existing tokens). -->
      <span class="flex gap-1.5">
        <Button
          type="button"
          variant="dialog-primary"
          size="kira-lg"
          class="gap-1"
          @click="connectionDialogStore.openCreateDialog"
        >
          <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="add" :size="13" /></span>
          New connection
        </Button>
        <Button
          type="button"
          variant="dialog"
          size="kira-lg"
          class="gap-1"
          data-testid="first-run-import-datagrip"
          @click="datagripImportStore.pickAndScanDataGripProject"
        >
          <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="cloud-download" :size="13" /></span>
          Import from DataGrip
        </Button>
      </span>
    </div>
  </div>

  <!-- Empty.html — connections exist, nothing open: recent tables and nothing else. -->
  <div v-else class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="no-tab-open">
    <div class="w-140 max-w-full">
      <div class="tracking-normal text-kira-xl text-fg">Kira Studio</div>
      <div class="text-kira-lg mt-1.5 text-muted-foreground">Pick something from the tree on the left, or reopen one of these.</div>

      <template v-if="recentTablesStore.entries.length > 0">
        <div class="uppercase tracking-wider text-kira-sm mb-1.5 mt-4 text-subtle">Recent tables</div>
        <div class="flex flex-col">
          <button
            v-for="entry in recentTablesStore.entries"
            :key="`${entry.kind}:${entry.connectionId}:${entry.path}`"
            type="button"
            class="w-full flex items-center cursor-pointer text-left rounded-kira-sm h-6.5 gap-1.5 px-1.5 text-fg text-kira-md hover:bg-hover"
            @click="openRecent(entry)"
          >
            <span
              class="w-0.5 h-3.5 rounded-xs shrink-0"
              :style="{ background: connColorVar(connectionFor(entry)?.color) ?? 'none' }"
            />
            <span class="size-4 flex items-center justify-center shrink-0" :style="{ color: iconColorFor(entry) }">
              <CodiconIcon :name="iconFor(entry)" :size="13" />
            </span>
            <span class="truncate min-w-0">{{ entry.path }}</span>
            <span class="ml-auto text-kira-xs text-subtle">{{ connectionFor(entry)?.name ?? '—' }} · {{ formatRelative(entry.openedAt) }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

