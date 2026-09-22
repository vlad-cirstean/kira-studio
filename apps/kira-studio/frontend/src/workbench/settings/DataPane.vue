<script setup lang="ts">
import IconButton from '@theme/primitives/IconButton.vue';
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
    <label class="field">
      <div class="field-head">
        <span>Default page size</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-data-defaultPageSize"
          :disabled="isAtDefault('data', 'defaultPageSize')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('data', 'defaultPageSize')"
        />
      </div>
      <select
        class="p-select bordered md"
        data-testid="settings-default-page-size"
        :value="draft.data.defaultPageSize"
        @change="onDefaultPageSizeChange"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
    </label>
  </div>
</template>
