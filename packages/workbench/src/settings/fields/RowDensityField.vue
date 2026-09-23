<script setup lang="ts">
import type { AppearanceSettings, RowDensity } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
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
  <div class="field">
    <div class="field-head">
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
    <div class="segmented">
      <button
        type="button"
        :class="{ active: appearance.rowDensity === 'compact' }"
        @click="setRowDensity('compact')"
      >
        Compact · 22 px
      </button>
      <button
        type="button"
        :class="{ active: appearance.rowDensity === 'comfortable' }"
        @click="setRowDensity('comfortable')"
      >
        Comfortable · 28 px
      </button>
    </div>
    <slot />
  </div>
</template>
