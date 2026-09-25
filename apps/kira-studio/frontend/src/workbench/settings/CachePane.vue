<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { formatBytes } from '@workbench/util/format';
import { computed, useId } from 'vue';
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

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field class="items-center"> div.
const cacheBudgetMbId = useId();
const currentUsageId = useId();
const hitRateId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="cacheBudgetMbId" class="text-kira-sm">Result page cache budget (MB)</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
          data-testid="settings-reset-cache-l2BudgetMb"
          :disabled-trigger="isAtDefault('cache', 'l2BudgetMb')"
          :disabled="isAtDefault('cache', 'l2BudgetMb')"
          @click="resetLeaf('cache', 'l2BudgetMb')"
        />
      </div>
      <NumberStepperInput
        :id="cacheBudgetMbId"
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
    </Field>
    <Field class="items-center">
      <Label :for="currentUsageId" class="text-kira-sm text-muted-foreground">Current usage</Label>
      <Input
        :id="currentUsageId"
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
        :model-value="cacheSizeLabel"
        disabled
      />
    </Field>
    <Field class="items-center">
      <Label :for="hitRateId" class="text-kira-sm text-muted-foreground">Hit rate</Label>
      <Input
        :id="hitRateId"
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
        :model-value="hitRateLabel"
        disabled
      />
    </Field>
    <Button variant="dialog" size="kira-lg" class="self-start" data-testid="settings-clear-caches" @click="onClearCaches">
      Clear caches
    </Button>
  </div>
</template>
