<script setup lang="ts">
// P129 Part 5 §0.9: the Later band's own row of controls (mockup 176-186) — `+ week` grows the
// scheduling horizon, `or date` (a future date, `min` = tomorrow) appends an extra day. Both are
// settings patches (`AdeRepoView`'s own `patchSettings` calls); this component only emits intent.
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
    <div class="flex items-center gap-2 py-1 pl-2">
      <button
        type="button"
        class="h-[22px] rounded border border-dashed border-[#3a3e48] bg-transparent px-2 text-kira-sm text-muted-foreground"
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
        class="h-[22px] rounded border border-dashed border-[#3a3e48] bg-transparent px-1.5 text-kira-sm text-[#c9c7c2]"
        style="color-scheme: dark"
        @input="onDate"
      />
    </div>
  </div>
</template>
