<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import { FONT_SIZE_RANGE } from '@shared/domain/settings';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription, FieldError } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import type { ComputedRef, Ref } from 'vue';
import { computed, useId } from 'vue';

// I2-18: the data font-size field (stepper, range error, reset button) was byte-identical between
// kira-studio's and kira-space's own AppearancePane.vue — moved here once, around P105 §4.2's own
// TooltipDisabledTrigger.
const props = defineProps<{
  appearance: AppearanceSettings;
  isAtDefault: (section: 'appearance', key: 'fontSize') => boolean;
  resetLeaf: (section: 'appearance', key: 'fontSize') => void;
  registerFieldError: (id: string, error: Ref<string | null> | ComputedRef<string | null>) => void;
}>();

function onFontSizeInput(e: Event): void {
  props.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

const fontSizeError = computed<string | null>(() => {
  const v = props.appearance.fontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});
props.registerFieldError('appearance.fontSize', fontSizeError);

// F3: see DateFormatField.vue's own comment -- `for` + `id` ties the label to the actual number
// input, not the stepper buttons (already `tabindex="-1"`/`aria-hidden` decorative) or the Reset
// button (a sibling, outside the label).
const fieldId = useId();
</script>

<template>
  <Field>
    <div class="flex items-center justify-between gap-1">
      <Label :for="fieldId" class="text-kira-sm">Data font size</Label>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        data-testid="settings-reset-appearance-fontSize"
        :disabled-trigger="isAtDefault('appearance', 'fontSize')"
        :disabled="isAtDefault('appearance', 'fontSize')"
        @click="resetLeaf('appearance', 'fontSize')"
      />
    </div>
    <NumberStepperInput
      :id="fieldId"
      :min="FONT_SIZE_RANGE.min"
      :max="FONT_SIZE_RANGE.max"
      :aria-invalid="!!fontSizeError || undefined"
      data-testid="settings-font-size"
      :model-value="String(appearance.fontSize)"
      @input="onFontSizeInput"
    />
    <FieldError v-if="fontSizeError" data-testid="settings-font-size-error">
      {{ fontSizeError }}
    </FieldError>
    <FieldDescription v-else>{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</FieldDescription>
  </Field>
</template>
