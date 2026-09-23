<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
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
  <div class="settings-pane" v-show="active">
    <Label class="field">
      <div class="field-head">
        <span>Default page size</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('data', 'defaultPageSize') }">
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
          </span>
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
