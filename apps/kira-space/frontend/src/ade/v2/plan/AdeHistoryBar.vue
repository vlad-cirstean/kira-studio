<script setup lang="ts">
import { Button } from '@theme/components/ui/button';

// Sticky bar while scrolled into the open history region.
const emit = defineEmits<{ goToDate: [iso: string]; hide: []; current: [] }>();

function onDate(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit('goToDate', v);
}
</script>

<template>
  <div
    class="mb-1.5 ml-15 flex items-center gap-2.5 rounded-kira border border-border-strong bg-elevated px-2.5 py-1.5 text-kira-md"
    data-testid="ade-history-bar"
  >
    <span class="font-semibold">History</span>
    <label for="ade-go-to-date" class="text-muted-foreground">Go to</label>
    <input
      id="ade-go-to-date"
      type="date"
      class="box-border h-6 rounded-kira-sm border border-border-strong bg-transparent px-1.5 text-kira-sm text-fg [color-scheme:dark]"
      data-testid="ade-go-to-date"
      @input="onDate"
    />
    <span class="flex-1" />
    <Button variant="dialog" size="xs" data-testid="ade-hide-history" @click="emit('hide')">
      Hide history
    </Button>
    <Button variant="dialog-primary" size="xs" data-testid="ade-current-work" @click="emit('current')">
      Current work ↓
    </Button>
  </div>
</template>
