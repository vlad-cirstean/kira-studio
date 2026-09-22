<script setup lang="ts">
import AppButton from '@theme/primitives/AppButton.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { data } from '../../bridge/data';
import { useCacheStatsStore } from '../../state/cacheStats';
import { CACHE_L2_BUDGET_MB_RANGE } from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Cache'"` branch.
const props = defineProps<SettingsPaneProps>();

const cacheStatsStore = useCacheStatsStore();

function onCacheBudgetInput(e: Event): void {
  props.draft.cache.l2BudgetMb = Number((e.target as HTMLInputElement).value);
}

const cacheBudgetError = computed<string | null>(() => {
  const v = props.draft.cache.l2BudgetMb;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < CACHE_L2_BUDGET_MB_RANGE.min || v > CACHE_L2_BUDGET_MB_RANGE.max) {
    return `${CACHE_L2_BUDGET_MB_RANGE.min}–${CACHE_L2_BUDGET_MB_RANGE.max} MB`;
  }
  return null;
});
props.registerFieldError('cache.l2BudgetMb', cacheBudgetError);

const hitRateLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return '—';
  const total = stats.l2Hits + stats.l2Misses;
  if (total === 0) return '—';
  return `${Math.round((stats.l2Hits / total) * 100)}% (${stats.l2Hits}/${total})`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return '—';
  return `${formatBytes(stats.l2Bytes)} / ${formatBytes(stats.l2BudgetBytes)}`;
});

async function onClearCaches(): Promise<void> {
  await data.clearCaches();
}
</script>

<template>
  <div class="settings-pane" v-show="active">
    <label class="field">
      <div class="field-head">
        <span>Result page cache budget (MB)</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-cache-l2BudgetMb"
          :disabled="isAtDefault('cache', 'l2BudgetMb')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('cache', 'l2BudgetMb')"
        />
      </div>
      <TextField
        type="number"
        :min="CACHE_L2_BUDGET_MB_RANGE.min"
        :max="CACHE_L2_BUDGET_MB_RANGE.max"
        size="md"
        :invalid="!!cacheBudgetError"
        data-testid="settings-cache-budget"
        :model-value="String(draft.cache.l2BudgetMb)"
        @input="onCacheBudgetInput"
      />
      <span v-if="cacheBudgetError" class="field-error" data-testid="settings-cache-budget-error">
        {{ cacheBudgetError }}
      </span>
    </label>
    <label class="field">
      <span>Current usage</span>
      <TextField type="text" size="md" :model-value="cacheSizeLabel" disabled />
    </label>
    <label class="field">
      <span>Hit rate</span>
      <TextField type="text" size="md" :model-value="hitRateLabel" disabled />
    </label>
    <AppButton
      kind="dialog"
      class="action-button"
      data-testid="settings-clear-caches"
      @click="onClearCaches"
    >
      Clear caches
    </AppButton>
  </div>
</template>
