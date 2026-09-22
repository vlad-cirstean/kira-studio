<script setup lang="ts">
import type { ApiVariableHistoryEntry } from '@shared/domain/variables';
import EmptyState from '@theme/primitives/EmptyState.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import { formatRelative } from '../format';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';
import { useVariableSetStore } from './state/variables';

const variableSetStore = useVariableSetStore();

// P5 D13: the per-row history popover, on the existing PopoverPanel, anchored to the row's own
// history button. Each entry's relative recorded time, its value (masked for a secret, with its
// own gated eye — a secret's old value is exactly as sensitive as its current one), and a Restore
// action, which writes it back through the ordinary Upsert path (so the restore is itself
// recorded, and therefore undoable).
const emit = defineEmits<{ close: [] }>();

function displayValue(entry: ApiVariableHistoryEntry): string {
  return entry.isSecret ? (variableSetStore.revealedHistoryValues[entry.id] ?? '') : entry.value;
}
function notYetRevealed(entry: ApiVariableHistoryEntry): boolean {
  return entry.isSecret && variableSetStore.revealedHistoryValues[entry.id] === undefined;
}

function onReveal(id: string): void {
  void variableSetStore.revealHistoryEntry(id);
}
function onRestore(entry: ApiVariableHistoryEntry): void {
  void variableSetStore.restoreHistoryEntry(entry);
}

function close(): void {
  variableSetStore.closeHistoryMenu();
  emit('close');
}
</script>

<template>
  <PopoverPanel
    :width="280"
    anchor="left"
    test-id="variable-history"
    backdrop-test-id="variable-history-backdrop"
    @close="close"
  >
    <div class="history-menu">
      <EmptyState
        v-if="variableSetStore.entries.length === 0"
        icon="history"
        label="No previous values"
        data-testid="variable-history-empty"
      />
      <div
        v-for="entry in variableSetStore.entries"
        :key="entry.id"
        class="history-entry"
        data-testid="variable-history-entry"
      >
        <div class="entry-main">
          <span class="entry-time">{{ formatRelative(entry.recordedAt) }}</span>
          <span v-if="notYetRevealed(entry)" class="entry-value masked" data-testid="variable-history-masked">
            ••••••••
          </span>
          <span v-else class="entry-value mono" data-testid="variable-history-value">{{
            displayValue(entry)
          }}</span>
        </div>
        <IconButton
          v-if="notYetRevealed(entry)"
          icon="eye"
          v-tooltip="'Reveal'"
          data-testid="variable-history-reveal"
          @click="onReveal(entry.id)"
        />
        <IconButton
          icon="reply"
          v-tooltip="'Restore'"
          data-testid="variable-history-restore"
          @click="onRestore(entry)"
        />
      </div>
    </div>
  </PopoverPanel>
</template>

<style scoped>
@reference "@theme/base.css";

.history-menu {
  @apply flex max-h-[320px] flex-col overflow-auto p-[var(--kira-s-2)];
}

.history-entry {
  @apply flex items-center gap-[var(--kira-s-2)] px-[var(--kira-s-3)] py-[var(--kira-s-2)];
}

.entry-main {
  @apply flex min-w-0 flex-1 flex-col gap-[var(--kira-s-1)];
}

.entry-time {
  @apply text-subtle text-[length:var(--kira-t-sm)];
}

.entry-value {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.entry-value.masked {
  @apply text-subtle tracking-[2px];
}
</style>
