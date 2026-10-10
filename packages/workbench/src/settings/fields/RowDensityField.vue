<script setup lang="ts">
import type { AppearanceSettings, RowDensity } from '@shared/domain/settings';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field } from '@theme/components/ui/field';

// I2-18: the row-density button pair (compact/comfortable) was byte-identical between kira-studio's
// and kira-space's own AppearancePane.vue; each app's own helper text and (kira-studio only) preview
// table stay app-side through the default slot.
const props = defineProps<{
  appearance: AppearanceSettings;
  isAtDefault: (section: 'appearance', key: 'rowDensity') => boolean;
  resetLeaf: (section: 'appearance', key: 'rowDensity') => void;
}>();

const DENSITY_ITEMS = [
  { value: 'compact', label: 'Compact · 22 px', testid: 'settings-appearance-rowDensity-compact' },
  { value: 'comfortable', label: 'Comfortable · 28 px', testid: 'settings-appearance-rowDensity-comfortable' },
];

function setRowDensity(density: RowDensity): void {
  props.appearance.rowDensity = density;
}
</script>

<template>
  <Field>
    <div class="flex items-center justify-between gap-1">
      <span>Row height</span>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        data-testid="settings-reset-appearance-rowDensity"
        :disabled-trigger="isAtDefault('appearance', 'rowDensity')"
        :disabled="isAtDefault('appearance', 'rowDensity')"
        @click="resetLeaf('appearance', 'rowDensity')"
      />
    </div>
    <SecondaryTabs
      variant="segmented"
      :model-value="appearance.rowDensity"
      :items="DENSITY_ITEMS"
      @update:model-value="(v) => setRowDensity(v as RowDensity)"
    />
    <slot />
  </Field>
</template>
