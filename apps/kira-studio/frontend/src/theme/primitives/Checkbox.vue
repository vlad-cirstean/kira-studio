<script setup lang="ts">
import CodiconIcon from '../CodiconIcon.vue';

// P15 D5: the real <input type="checkbox"> *is* the styled box (appearance: none, then drawn by
// .p-check in primitives.css) rather than a hidden input plus a fake one — so Playwright's
// .check()/input[type="checkbox"] selectors, native keyboard/focus, and <label>-wrapping all keep
// working with no retrofit. inheritAttrs is off for the same reason TextField.vue:6-9 turns it
// off: data-testid, :disabled-adjacent attrs like @click.stop, and any other attribute a call site
// writes belong on the real input a test drives, not on this wrapping <span class="p-check">.
defineOptions({ inheritAttrs: false });

defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  /** FiltersDialog's object tree is the app's only indeterminate checkbox — forwarded as a real
   *  DOM property (`:indeterminate.prop`), not an attribute, since indeterminate has no HTML
   *  attribute form. */
  indeterminate?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <span class="p-check" :class="{ 'is-disabled': disabled }">
    <input
      type="checkbox"
      autocomplete="off"
      v-bind="$attrs"
      :checked="modelValue"
      :indeterminate.prop="indeterminate"
      :disabled="disabled"
      @change="onChange"
    />
    <CodiconIcon
      v-if="modelValue || indeterminate"
      :name="indeterminate ? 'dash' : 'check'"
      :size="10"
      class="glyph"
    />
  </span>
</template>
