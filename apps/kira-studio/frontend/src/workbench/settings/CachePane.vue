<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
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
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('cache', 'l2BudgetMb') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-cache-l2BudgetMb"
              :disabled="isAtDefault('cache', 'l2BudgetMb')"
              aria-label="Reset to default"
              @click="resetLeaf('cache', 'l2BudgetMb')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="CACHE_L2_BUDGET_MB_RANGE.min"
        :max="CACHE_L2_BUDGET_MB_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :aria-invalid="!!cacheBudgetError || undefined"
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
      <Input
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :model-value="cacheSizeLabel"
        disabled
      />
    </label>
    <label class="field">
      <span>Hit rate</span>
      <Input
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :model-value="hitRateLabel"
        disabled
      />
    </label>
    <Button variant="dialog" size="kira-lg" class="action-button" data-testid="settings-clear-caches" @click="onClearCaches">
      Clear caches
    </Button>
  </div>
</template>
