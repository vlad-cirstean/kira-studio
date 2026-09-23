<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';

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
</script>

<template>
  <Label class="field">
    <div class="field-head">
      <span>Commit date</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'dateFormat') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-dateFormat"
              :disabled="isAtDefault('appearance', 'dateFormat')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'dateFormat')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>
    <select
      class="p-select bordered md"
      data-testid="settings-date-format"
      :value="appearance.dateFormat"
      @change="onDateFormatChange"
    >
      <option value="relative">Relative (3 days ago)</option>
      <option value="absolute">Absolute (2024-12-30 22:48)</option>
    </select>
    <span class="helper-text">The git graph's own commit timestamps.</span>
  </Label>
</template>
