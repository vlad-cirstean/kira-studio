<script setup lang="ts">
// The Later band's row: `+ week` grows the horizon, `or date` appends one future day.
defineProps<{ minDate: string }>();
const emit = defineEmits<{ moreWeek: []; pickDate: [iso: string] }>();

function onDate(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit('pickDate', v);
}
</script>

<template>
  <div class="flex">
    <div class="w-15 shrink-0 border-r-2 border-border-strong" />
    <div class="flex items-center gap-2 pb-2 pl-2 pt-1">
      <button
        type="button"
        class="h-control rounded-kira-sm border border-dashed border-border-strong bg-transparent px-2 text-kira-sm text-muted-foreground"
        data-testid="ade-more-week"
        @click="emit('moreWeek')"
      >
        + week
      </button>
      <label for="ade-add-day" class="text-kira-sm text-muted-foreground">or date</label>
      <input
        id="ade-add-day"
        type="date"
        :min="minDate"
        class="box-border h-control rounded-kira-sm border border-dashed border-border-strong bg-transparent px-1.5 text-kira-sm text-fg [color-scheme:dark]"
        data-testid="ade-add-day"
        @input="onDate"
      />
    </div>
  </div>
</template>
