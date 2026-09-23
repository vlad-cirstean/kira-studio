<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import { FONT_SIZE_RANGE } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref, useId } from 'vue';

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

const fontSizeGroupRef = ref<HTMLElement | null>(null);
const fontSizeStepper = useNumberStepper(fontSizeGroupRef);

// F3: see DateFormatField.vue's own comment -- `for` + `id` ties the label to the actual number
// input, not the stepper buttons (already `tabindex="-1"`/`aria-hidden` decorative) or the Reset
// button (a sibling, outside the label).
const fieldId = useId();
</script>

<template>
  <div class="field">
    <div class="field-head">
      <Label :for="fieldId">Data font size</Label>
      <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'fontSize') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-fontSize"
              :disabled="isAtDefault('appearance', 'fontSize')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'fontSize')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>
    <div class="size-input" ref="fontSizeGroupRef">
      <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
        <InputGroupInput
          :id="fieldId"
          type="number"
          :min="FONT_SIZE_RANGE.min"
          :max="FONT_SIZE_RANGE.max"
          class="h-full font-data"
          :aria-invalid="!!fontSizeError || undefined"
          data-testid="settings-font-size"
          :model-value="String(appearance.fontSize)"
          @input="onFontSizeInput"
        />
        <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton
                class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                tabindex="-1"
                aria-hidden="true"
                @mousedown.prevent="fontSizeStepper.stepBy(1)"
              >
                <CodiconIcon name="chevron-up" :size="9" />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>Increase</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <InputGroupButton
                class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                tabindex="-1"
                aria-hidden="true"
                @mousedown.prevent="fontSizeStepper.stepBy(-1)"
              >
                <CodiconIcon name="chevron-down" :size="9" />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>Decrease</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
    </div>
    <span v-if="fontSizeError" class="field-error" data-testid="settings-font-size-error">
      {{ fontSizeError }}
    </span>
    <span v-else class="helper-text">{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span>
  </div>
</template>
