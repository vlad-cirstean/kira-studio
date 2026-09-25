<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError, fieldVariants } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
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
  <div class="contents" v-show="active">
    <Label :class="fieldVariants()">
      <div class="flex items-center justify-between gap-1">
        <span>Result page cache budget (MB)</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('cache', 'l2BudgetMb') }">
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
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :min="CACHE_L2_BUDGET_MB_RANGE.min"
        :max="CACHE_L2_BUDGET_MB_RANGE.max"
        :aria-invalid="!!cacheBudgetError || undefined"
        data-testid="settings-cache-budget"
        :model-value="String(draft.cache.l2BudgetMb)"
        @input="onCacheBudgetInput"
      />
      <FieldError v-if="cacheBudgetError" data-testid="settings-cache-budget-error">
        {{ cacheBudgetError }}
      </FieldError>
    </Label>
    <Label :class="fieldVariants()">
      <span class="text-muted-foreground">Current usage</span>
      <Input
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
        :model-value="cacheSizeLabel"
        disabled
      />
    </Label>
    <Label :class="fieldVariants()">
      <span class="text-muted-foreground">Hit rate</span>
      <Input
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
        :model-value="hitRateLabel"
        disabled
      />
    </Label>
    <Button variant="dialog" size="kira-lg" class="self-start" data-testid="settings-clear-caches" @click="onClearCaches">
      Clear caches
    </Button>
  </div>
</template>
