<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError, fieldVariants } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { formatBytes } from '@workbench/util/format';
import { computed, ref } from 'vue';
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

// P104 §2: TextField's number stepper -> ui/input-group recipe.
const l2BudgetMbGroupRef = ref<HTMLElement | null>(null);
const l2BudgetMbStepper = useNumberStepper(l2BudgetMbGroupRef);

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
      <span ref="l2BudgetMbGroupRef" class="contents">
        <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field">
          <InputGroupInput
            type="number"
            :min="CACHE_L2_BUDGET_MB_RANGE.min"
            :max="CACHE_L2_BUDGET_MB_RANGE.max"
            class="h-full font-data"
            :aria-invalid="!!cacheBudgetError || undefined"
            data-testid="settings-cache-budget"
            :model-value="String(draft.cache.l2BudgetMb)"
            @input="onCacheBudgetInput"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  @mousedown.prevent="l2BudgetMbStepper.stepBy(1)"
                >
                  <CodiconIcon name="chevron-up" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Increase</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  @mousedown.prevent="l2BudgetMbStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </span>
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
    <Button variant="dialog" size="kira-lg" class="action-button" data-testid="settings-clear-caches" @click="onClearCaches">
      Clear caches
    </Button>
  </div>
</template>
