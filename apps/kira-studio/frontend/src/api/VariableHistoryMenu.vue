<script setup lang="ts">
import type { ApiVariableHistoryEntry } from '@shared/domain/variables';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';
import {
  closeHistoryMenu,
  historyMenuState,
  restoreHistoryEntry,
  revealedHistoryValues,
  revealHistoryEntry,
} from './state/variables';

// P5 D13: the per-row history popover, on the existing PopoverPanel, anchored to the row's own
// history button. Each entry's relative recorded time, its value (masked for a secret, with its
// own gated eye — a secret's old value is exactly as sensitive as its current one), and a Restore
// action, which writes it back through the ordinary Upsert path (so the restore is itself
// recorded, and therefore undoable).
const emit = defineEmits<{ close: [] }>();

/** No shared "relative time" helper reaches http/** (state/** is the one directory both project/**
 *  and http/** may import, and it has no such utility) — this is a plain, small, self-contained
 *  duplicate of the same idea StudioStart.vue's own formatRelative already is. */
function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function displayValue(entry: ApiVariableHistoryEntry): string {
  return entry.isSecret ? (revealedHistoryValues[entry.id] ?? '') : entry.value;
}
function notYetRevealed(entry: ApiVariableHistoryEntry): boolean {
  return entry.isSecret && revealedHistoryValues[entry.id] === undefined;
}

function onReveal(id: string): void {
  void revealHistoryEntry(id);
}
function onRestore(entry: ApiVariableHistoryEntry): void {
  void restoreHistoryEntry(entry);
}

function close(): void {
  closeHistoryMenu();
  emit('close');
}
</script>

<template>
  <PopoverPanel
    :width="280"
    test-id="variable-history"
    backdrop-test-id="variable-history-backdrop"
    @close="close"
  >
    <div class="history-menu">
      <EmptyState
        v-if="historyMenuState.entries.length === 0"
        icon="history"
        label="No previous values"
        data-testid="variable-history-empty"
      />
      <div
        v-for="entry in historyMenuState.entries"
        :key="entry.id"
        class="history-entry"
        data-testid="variable-history-entry"
      >
        <div class="entry-main">
          <span class="entry-time">{{ relativeTime(entry.recordedAt) }}</span>
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
.history-menu {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: auto;
  padding: var(--kira-s-2);
}

.history-entry {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.entry-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

.entry-time {
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-sm);
}

.entry-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-value.masked {
  color: var(--kira-fg-disabled);
  letter-spacing: 2px;
}
</style>
