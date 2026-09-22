<script setup lang="ts">
import CodiconIcon from '../CodiconIcon.vue';

// P15 D5: the real <input type="checkbox"> *is* the styled box (appearance: none, styled with
// Tailwind utilities below) rather than a hidden input plus a fake one — so Playwright's
// .check()/input[type="checkbox"] selectors, native keyboard/focus, and <label>-wrapping all keep
// working with no retrofit. inheritAttrs is off for the same reason TextField.vue:6-9 turns it
// off: data-testid, :disabled-adjacent attrs like @click.stop, and any other attribute a call site
// writes belong on the real input a test drives, not on this wrapping <span class="p-check">.
//
// P99 Part 2 (§6.2): declined reka-ui's CheckboxRoot — it renders a `<button role="checkbox">`,
// not a real `<input type="checkbox">`, which would break every `.check()`/native-form-semantics
// caller the comment above names. Styling moved onto Tailwind; `.p-check` stays as a marker.
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
  <span
    class="p-check relative mt-[var(--kira-s-1)] inline-flex h-[var(--kira-control-inline-h)] w-[var(--kira-control-inline-h)] shrink-0 items-center justify-center"
    :class="{ 'is-disabled': disabled }"
  >
    <input
      type="checkbox"
      autocomplete="off"
      v-bind="$attrs"
      :checked="modelValue"
      :indeterminate.prop="indeterminate"
      :disabled="disabled"
      class="m-0 h-[var(--kira-control-inline-h)] w-[var(--kira-control-inline-h)] cursor-pointer appearance-none rounded-[3px] border border-border-strong bg-input checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-45"
      @change="onChange"
    />
    <CodiconIcon
      v-if="modelValue || indeterminate"
      :name="indeterminate ? 'dash' : 'check'"
      :size="10"
      class="glyph pointer-events-none absolute inset-0 flex items-center justify-center text-accent-fg"
      :class="indeterminate ? 'translate-y-[-0.03125em]' : 'translate-y-[0.03125em]'"
    />
  </span>
</template>
