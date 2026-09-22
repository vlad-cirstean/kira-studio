<script setup lang="ts">
import IconButton from './IconButton.vue';
import TextField from './TextField.vue';

// P1 C2: project/SearchBox.vue, converted to a plain v-model instead of writing
// treeState.search directly (F8) — a search box shared by more than one mode cannot import
// Studio's tree state.
// P16 D10: `placeholder`/`testid` are optional, defaulting to the collections tree's own values —
// PanelShell.vue's existing call site is byte-identical in behaviour (and tree.spec.ts's
// `tree-search` selector untouched) while the six new Api call sites this phase adds get their
// own label and a distinct data-testid.
withDefaults(defineProps<{ modelValue: string; placeholder?: string; testid?: string }>(), {
  placeholder: 'Search',
  testid: 'tree-search',
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <div
    class="search-box-row shrink-0 px-[var(--kira-s-3)] py-[var(--kira-s-2)] border-b border-border"
  >
    <div class="search-box relative w-full">
      <TextField
        :model-value="modelValue"
        ui
        icon="search"
        :placeholder="placeholder"
        :data-testid="testid"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <IconButton
        v-if="modelValue"
        icon="close"
        class="clear-button absolute top-1/2 right-[var(--kira-s-1)] -translate-y-1/2 shrink-0"
        v-tooltip="'Clear search'"
        aria-label="Clear search"
        @click="emit('update:modelValue', '')"
      />
    </div>
  </div>
</template>

<style scoped>
/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so these two reach past the component boundary —
   no Tailwind utility can target another component's internal DOM, so :deep() stays hand CSS
   (§9.2). */
.search-box :deep(.p-input) {
  width: 100%;
}
.search-box :deep(input) {
  padding-right: var(--kira-s-6);
}
</style>
