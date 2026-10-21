<script setup lang="ts">
// The 10-utility swatch label/input/span recipe, carried once instead of 4 times (ScriptDialog.vue
// x2, VariableSetView.vue, ConnectionDialog.vue). The outline fix is already reflected here:
// peer-focus-visible:focus-ring stays always-on utility, the selected-state outline is the only
// conditional class.
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { connBgClass } from './connColor';

defineProps<{
  name: string;
  value: string;
  color: string;
  checked: boolean;
}>();

const emit = defineEmits<{ change: [value: string] }>();
</script>

<template>
  <Label class="swatch-label relative flex size-4 shrink-0 cursor-default gap-0">
    <input
      type="radio"
      :name="name"
      class="peer absolute inset-0 size-full cursor-default opacity-0"
      :value="value"
      :checked="checked"
      :aria-label="color === 'none' ? t('common.field.noColour.label') : color"
      :data-testid="`color-${color}`"
      @change="emit('change', value)"
    >
    <!-- P105 §7: noLabelWithoutControl can't see a label's own <input> child past an *empty*
         sibling element — &nbsp; keeps this decorative span non-empty. -->
    <span
      aria-hidden="true"
      class="swatch pointer-events-none size-4 shrink-0 overflow-hidden rounded-full peer-focus-visible:focus-ring"
      :class="[
        {
          'outline-2 outline-offset-2 outline-fg': checked,
          'swatch-none': color === 'none',
        },
        connBgClass(color),
      ]"
      >&nbsp;</span
    >
  </Label>
</template>
