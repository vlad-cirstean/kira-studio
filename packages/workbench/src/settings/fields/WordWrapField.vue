<script setup lang="ts">
import type { AppearanceSettings } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';

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
</script>

<template>
  <div class="field checkbox-row">
    <Label class="field checkbox">
      <Checkbox
        class="size-3.5"
        :model-value="appearance.wordWrap"
        data-testid="settings-word-wrap"
        @update:model-value="(v) => onWordWrapChange(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <span>Word wrap</span>
      <slot />
    </Label>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'wordWrap') }">
          <Button
            variant="toolbar"
            size="kira-icon"
            class="p-push"
            data-testid="settings-reset-appearance-wordWrap"
            :disabled="isAtDefault('appearance', 'wordWrap')"
            aria-label="Reset to default"
            @click="resetLeaf('appearance', 'wordWrap')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
    </Tooltip>
  </div>
</template>
