<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldGroup } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { useId } from 'vue';

// I2-18: the word-wrap checkbox row (checkbox, reset button) was byte-identical between
// kira-studio's and kira-space's own AppearancePane.vue; the helper text differs per app (each
// names its own word-wrap surfaces), so it stays app-side through the default slot.
const props = defineProps<{
  appearance: AppearanceSettings;
  isAtDefault: (section: 'appearance', key: 'wordWrap') => boolean;
  resetLeaf: (section: 'appearance', key: 'wordWrap') => void;
}>();

function onWordWrapChange(checked: boolean): void {
  props.appearance.wordWrap = checked;
}

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const wordWrapId = useId();
</script>

<template>
  <FieldGroup>
    <Field orientation="horizontal">
      <Checkbox
        :id="wordWrapId"
        class="size-3.5"
        :model-value="appearance.wordWrap"
        data-testid="settings-word-wrap"
        @update:model-value="(v) => onWordWrapChange(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <Label :for="wordWrapId" class="text-kira-sm">Word wrap</Label>
      <slot />
    </Field>
    <TooltipIconButton
      icon="discard"
      label="Reset to default"
      class="ml-auto"
      data-testid="settings-reset-appearance-wordWrap"
      :disabled-trigger="isAtDefault('appearance', 'wordWrap')"
      :disabled="isAtDefault('appearance', 'wordWrap')"
      @click="resetLeaf('appearance', 'wordWrap')"
    />
  </FieldGroup>
</template>
