<script setup lang="ts">
import type { ApiVariableHistoryEntry } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { PopoverContent } from '@theme/components/ui/popover';
import { formatRelative } from '@workbench/util/format';
import { useVariableSetStore } from './state/variables';

const variableSetStore = useVariableSetStore();

// P5 D13: the per-row history popover — a PopoverContent anchored to the row's own history button
// via VariableRow.vue's own PopoverAnchor (a plain content component; VariableRow.vue's Popover
// owns open state and the closeHistoryMenu() side effect for every dismissal). Each entry's
// relative recorded time, its value (masked for a secret, with its own gated eye — a secret's old
// value is exactly as sensitive as its current one), and a Restore action, which writes it back
// through the ordinary Upsert path (so the restore is itself recorded, and therefore undoable).

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
</script>

<template>
  <PopoverContent align="start" class="w-72 gap-0 p-0" data-testid="variable-history">
    <div class="flex max-h-80 flex-col overflow-auto p-1">
      <Empty
        v-if="variableSetStore.entries.length === 0"
        data-testid="variable-history-empty"
      >
        <EmptyMedia><CodiconIcon name="history" :size="24" /></EmptyMedia>
        <EmptyTitle>No previous values</EmptyTitle>
      </Empty>
      <div
        v-for="entry in variableSetStore.entries"
        :key="entry.id"
        class="flex items-center gap-1 px-1.5 py-1"
        data-testid="variable-history-entry"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-subtle text-kira-sm">{{ formatRelative(entry.recordedAt) }}</span>
          <!-- tracking-widest (0.1em) is the widest step Tailwind's default scale has; at this
               span's inherited font-size (PopoverContent's own text-sm, 14px) that is 1.4px, not
               the original flat 2px, but nothing further out exists on the scale. -->
          <span
            v-if="notYetRevealed(entry)"
            class="overflow-hidden text-ellipsis whitespace-nowrap text-subtle tracking-widest"
            data-testid="variable-history-masked"
          >
            ••••••••
          </span>
          <span v-else class="overflow-hidden text-ellipsis whitespace-nowrap font-data" data-testid="variable-history-value">{{
            displayValue(entry)
          }}</span>
        </div>
        <TooltipIconButton
          v-if="notYetRevealed(entry)"
          icon="eye"
          label="Reveal"
          data-testid="variable-history-reveal"
          @click="onReveal(entry.id)"
        />
        <TooltipIconButton
          icon="reply"
          label="Restore"
          data-testid="variable-history-restore"
          @click="onRestore(entry)"
        />
      </div>
    </div>
  </PopoverContent>
</template>
