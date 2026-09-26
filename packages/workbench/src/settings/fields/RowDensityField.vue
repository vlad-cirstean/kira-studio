<script setup lang="ts">
import type { AppearanceSettings, RowDensity } from '@shared/domain/settings';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field } from '@theme/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';

// I2-18: the row-density button pair (compact/comfortable) was byte-identical between kira-studio's
// and kira-space's own AppearancePane.vue; each app's own helper text and (kira-studio only) preview
// table stay app-side through the default slot.
const props = defineProps<{
  appearance: AppearanceSettings;
  isAtDefault: (section: 'appearance', key: 'rowDensity') => boolean;
  resetLeaf: (section: 'appearance', key: 'rowDensity') => void;
}>();

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
    <!-- P110 B33: .segmented -> ToggleGroup (pre-approved, plan 1.4). data-testid replaces the old
         `.segmented button` positional CSS locator settings-apply-on-save.spec.ts used. -->
    <ToggleGroup
      type="single"
      variant="outline"
      size="kira"
      :model-value="appearance.rowDensity"
      @update:model-value="(v) => v && setRowDensity(v as RowDensity)"
    >
      <ToggleGroupItem value="compact" data-testid="settings-appearance-rowDensity-compact">
        Compact · 22 px
      </ToggleGroupItem>
      <ToggleGroupItem value="comfortable" data-testid="settings-appearance-rowDensity-comfortable">
        Comfortable · 28 px
      </ToggleGroupItem>
    </ToggleGroup>
    <slot />
  </Field>
</template>
