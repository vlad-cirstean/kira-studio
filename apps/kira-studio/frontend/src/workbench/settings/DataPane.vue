<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Field } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useId } from 'vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Data'"` branch.
const props = defineProps<SettingsPaneProps>();

const PAGE_SIZES = [10, 100, 1000, 10000] as const;

function onDefaultPageSizeChange(rawValue: unknown): void {
  const value = Number(rawValue);
  const pageSize = PAGE_SIZES.find((size) => size === value);
  if (!pageSize) return;
  props.draft.data.defaultPageSize = pageSize;
}

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field class="items-center"> div.
const defaultPageSizeId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="defaultPageSizeId" class="text-kira-sm">Default page size</Label>
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
      <NativeSelect
        :id="defaultPageSizeId"
        variant="bordered"
        size="kira-lg"
        data-testid="settings-default-page-size"
        :model-value="draft.data.defaultPageSize"
        @update:model-value="onDefaultPageSizeChange"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </NativeSelect>
    </Field>
  </div>
</template>
