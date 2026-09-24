<script setup lang="ts">
import type { AppearanceSettings, RowDensity } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Field } from '@theme/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';

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
      <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'rowDensity') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-rowDensity"
              :disabled="isAtDefault('appearance', 'rowDensity')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'rowDensity')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>
    <!-- P110 B33: .segmented -> ToggleGroup (pre-approved, plan 1.4). data-testid replaces the old
         `.segmented button` positional CSS locator settings-apply-on-save.spec.ts used. -->
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
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
