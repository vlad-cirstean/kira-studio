<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { fieldVariants } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Data'"` branch.
const props = defineProps<SettingsPaneProps>();

const PAGE_SIZES = [10, 100, 1000, 10000] as const;

function onDefaultPageSizeChange(e: Event): void {
  const value = Number((e.target as HTMLSelectElement).value);
  const pageSize = PAGE_SIZES.find((size) => size === value);
  if (!pageSize) return;
  props.draft.data.defaultPageSize = pageSize;
}
</script>

<template>
  <div class="contents" v-show="active">
    <Label :class="fieldVariants()">
      <div class="flex items-center justify-between gap-1">
        <span>Default page size</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('data', 'defaultPageSize') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-data-defaultPageSize"
              :disabled="isAtDefault('data', 'defaultPageSize')"
              aria-label="Reset to default"
              @click="resetLeaf('data', 'defaultPageSize')"
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
        data-testid="settings-default-page-size"
        :value="draft.data.defaultPageSize"
        @change="onDefaultPageSizeChange"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
    </Label>
  </div>
</template>
