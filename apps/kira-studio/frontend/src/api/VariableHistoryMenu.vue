<script setup lang="ts">
import type { ApiVariableHistoryEntry } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { PopoverContent } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
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
    <div class="history-menu">
      <Alert
        v-if="variableSetStore.entries.length === 0"
        class="empty-state"
        data-testid="variable-history-empty"
      >
        <CodiconIcon name="history" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted font-normal">No previous values</AlertTitle>
      </Alert>
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
        <Tooltip v-if="notYetRevealed(entry)">
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              aria-label="Reveal"
              data-testid="variable-history-reveal"
              @click="onReveal(entry.id)"
            >
              <CodiconIcon name="eye" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reveal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              aria-label="Restore"
              data-testid="variable-history-restore"
              @click="onRestore(entry)"
            >
              <CodiconIcon name="reply" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Restore</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </PopoverContent>
</template>

<style scoped>
@reference "@theme/base.css";

.history-menu {
  @apply flex max-h-80 flex-col overflow-auto p-1;
}

.history-entry {
  @apply flex items-center gap-1 px-1.5 py-1;
}

.entry-main {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}

.entry-time {
  @apply text-subtle text-kira-sm;
}

.entry-value {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

/* v1.9 tailwind-declines deep dive: tracking-widest (0.1em) is the widest step Tailwind's default
   scale has; at this span's inherited font-size (PopoverContent's own text-sm, 14px) that is
   1.4px, not the original flat 2px, but nothing further out exists on the scale. */
.entry-value.masked {
  @apply text-subtle tracking-widest;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
</style>
