<script setup lang="ts">
// P110 I2-24 (§3.10): the 10-utility swatch label/input/span recipe, carried once instead of 4
// times (ScriptsPane.vue x2, VariableSetView.vue, ConnectionDialog.vue). The outline fix from
// I2-8 is already reflected here: peer-focus-visible:outline-* stays always-on utility, the
// selected-state outline is the only conditional class.
defineProps<{
  name: string;
  value: string;
  color: string;
  checked: boolean;
}>();

const emit = defineEmits<{ change: [value: string] }>();
</script>

<template>
  <label class="swatch-label relative flex h-4 w-4 shrink-0 cursor-pointer">
    <input
      type="radio"
      :name="name"
      class="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      :value="value"
      :checked="checked"
      :aria-label="color === 'none' ? 'No colour' : color"
      :data-testid="`color-${color}`"
      @change="emit('change', value)"
    />
    <!-- P105 §7: noLabelWithoutControl can't see a label's own <input> child past an *empty*
         sibling element — &nbsp; keeps this decorative span non-empty. -->
    <span
      aria-hidden="true"
      class="swatch pointer-events-none h-4 w-4 shrink-0 overflow-hidden rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg"
      :class="{
        'outline-2 outline-offset-2 outline-fg': checked,
        'swatch-none': color === 'none',
      }"
      :style="color === 'none' ? undefined : { background: `var(--kira-conn-${color})` }"
      >&nbsp;</span
    >
  </label>
</template>
