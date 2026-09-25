<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { useId } from 'vue';

// I2-18: the commit-date leaf (select, reset button, helper text) was byte-identical between
// kira-studio's and kira-space's own AppearancePane.vue.
const props = defineProps<{
  appearance: AppearanceSettings;
  isAtDefault: (section: 'appearance', key: 'dateFormat') => boolean;
  resetLeaf: (section: 'appearance', key: 'dateFormat') => void;
}>();

function onDateFormatChange(e: Event): void {
  props.appearance.dateFormat = (e.target as HTMLSelectElement).value as AppearanceSettings['dateFormat'];
}

// F3: a native `<label>` delegates its click to its first labelable descendant -- with the Reset
// `<Button>` living inside the label (the old markup), that was the button, not the select, so
// clicking the title/helper text reset the field instead of focusing the control. `for` + `id`
// ties the label to the select explicitly instead, with the button as a sibling outside it.
const fieldId = useId();
</script>

<template>
  <Field>
    <div class="flex items-center justify-between gap-1">
      <Label :for="fieldId">Commit date</Label>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        data-testid="settings-reset-appearance-dateFormat"
        :disabled-trigger="isAtDefault('appearance', 'dateFormat')"
        :disabled="isAtDefault('appearance', 'dateFormat')"
        @click="resetLeaf('appearance', 'dateFormat')"
      />
    </div>
    <NativeSelect
      :id="fieldId"
      variant="bordered"
      size="kira-lg"
      data-testid="settings-date-format"
      :value="appearance.dateFormat"
      @change="onDateFormatChange"
    >
      <option value="relative">Relative (3 days ago)</option>
      <option value="absolute">Absolute (2024-12-30 22:48)</option>
    </NativeSelect>
    <FieldDescription>The git graph's own commit timestamps.</FieldDescription>
  </Field>
</template>
