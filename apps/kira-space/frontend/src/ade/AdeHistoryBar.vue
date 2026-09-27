<script setup lang="ts">
// P129 Part 5 §0.9: the sticky History bar, shown while scrolled into the open history region
// (mockup 157-166) — "Go to" here does double duty (§0.9): a past date grows `historyReach`, a
// future date beyond the horizon appends to `settings.ade.extraDays`; both are `AdeRepoView`'s own
// scroll-owning logic, this component only emits the picked ISO date.
const emit = defineEmits<{ goToDate: [iso: string]; hide: []; current: [] }>();

function onDate(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit('goToDate', v);
}
</script>

<template>
  <div
    class="ml-15 mb-1.5 flex items-center gap-2.5 rounded-kira-sm border border-[#2f323b] bg-[#1b1d22] px-2.5 py-1.5 text-kira-sm"
    data-testid="ade-history-bar"
  >
    <span class="font-semibold">History</span>
    <label for="ade-go-to-date" class="text-muted-foreground">Go to</label>
    <input
      id="ade-go-to-date"
      type="date"
      class="h-6 rounded border border-[#3a3e48] bg-transparent px-1.5 text-kira-sm text-[#c9c7c2]"
      style="color-scheme: dark"
      @input="onDate"
    />
    <span class="flex-1" />
    <button
      type="button"
      class="h-6 rounded border border-[#3a3e48] bg-transparent px-2.5 text-kira-sm text-[#c9c7c2]"
      data-testid="ade-hide-history"
      @click="emit('hide')"
    >
      Hide history
    </button>
    <button
      type="button"
      class="h-6 rounded bg-[#e8a33d] px-2.5 text-kira-sm font-semibold text-[#15161a]"
      data-testid="ade-current-work"
      @click="emit('current')"
    >
      Current work ↓
    </button>
  </div>
</template>
