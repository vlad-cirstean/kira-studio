<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldError, fieldVariants } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import GitLogLevelField from '@workbench/settings/fields/GitLogLevelField.vue';
import { computed } from 'vue';
import {
  EXPENSIVE_QUERY_ROWS_RANGE,
  OP_LOG_RETENTION_DAYS_RANGE,
} from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Advanced'"` branch.
const props = defineProps<SettingsPaneProps>();

function onOpLogRetentionInput(e: Event): void {
  props.draft.advanced.opLogRetentionDays = Number((e.target as HTMLInputElement).value);
}

function onExpensiveQueryRowsInput(e: Event): void {
  props.draft.advanced.expensiveQueryRows = Number((e.target as HTMLInputElement).value);
}

const opLogRetentionError = computed<string | null>(() => {
  const v = props.draft.advanced.opLogRetentionDays;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < OP_LOG_RETENTION_DAYS_RANGE.min || v > OP_LOG_RETENTION_DAYS_RANGE.max) {
    return `${OP_LOG_RETENTION_DAYS_RANGE.min}–${OP_LOG_RETENTION_DAYS_RANGE.max} days`;
  }
  return null;
});
props.registerFieldError('advanced.opLogRetentionDays', opLogRetentionError);

const expensiveQueryRowsError = computed<string | null>(() => {
  const v = props.draft.advanced.expensiveQueryRows;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < EXPENSIVE_QUERY_ROWS_RANGE.min || v > EXPENSIVE_QUERY_ROWS_RANGE.max) {
    return `${EXPENSIVE_QUERY_ROWS_RANGE.min.toLocaleString()}–${EXPENSIVE_QUERY_ROWS_RANGE.max.toLocaleString()}`;
  }
  return null;
});
props.registerFieldError('advanced.expensiveQueryRows', expensiveQueryRowsError);
</script>

<template>
  <div class="contents" v-show="active">
    <Label :class="fieldVariants()">
      <div class="flex items-center justify-between gap-1">
        <span>Operation log retention (days)</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('advanced', 'opLogRetentionDays') }">
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="settings-reset-advanced-opLogRetentionDays"
                :disabled="isAtDefault('advanced', 'opLogRetentionDays')"
                aria-label="Reset to default"
                @click="resetLeaf('advanced', 'opLogRetentionDays')"
              >
                <CodiconIcon name="discard" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :min="OP_LOG_RETENTION_DAYS_RANGE.min"
        :max="OP_LOG_RETENTION_DAYS_RANGE.max"
        :aria-invalid="!!opLogRetentionError || undefined"
        data-testid="settings-oplog-retention"
        :model-value="String(draft.advanced.opLogRetentionDays)"
        @input="onOpLogRetentionInput"
      />
      <FieldError v-if="opLogRetentionError" data-testid="settings-oplog-retention-error">
        {{ opLogRetentionError }}
      </FieldError>
    </Label>
    <p class="text-subtle text-kira-xs">Takes effect after restart.</p>

    <Label :class="fieldVariants()">
      <div class="flex items-center justify-between gap-1">
        <span>Expensive query threshold (rows)</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('advanced', 'expensiveQueryRows') }">
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="settings-reset-advanced-expensiveQueryRows"
                :disabled="isAtDefault('advanced', 'expensiveQueryRows')"
                aria-label="Reset to default"
                @click="resetLeaf('advanced', 'expensiveQueryRows')"
              >
                <CodiconIcon name="discard" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :min="EXPENSIVE_QUERY_ROWS_RANGE.min"
        :max="EXPENSIVE_QUERY_ROWS_RANGE.max"
        :aria-invalid="!!expensiveQueryRowsError || undefined"
        data-testid="settings-expensive-query-rows"
        :model-value="String(draft.advanced.expensiveQueryRows)"
        @input="onExpensiveQueryRowsInput"
      />
      <FieldError
        v-if="expensiveQueryRowsError"
        data-testid="settings-expensive-query-rows-error"
      >
        {{ expensiveQueryRowsError }}
      </FieldError>
      <FieldDescription v-else
        >A query whose plan is estimated to read at least this many rows is flagged as
        expensive by the console's Explain button and by auto-explain. Not comparable
        across engines' own cost figures — see the plan panel's own note.</FieldDescription
      >
    </Label>

    <GitLogLevelField :advanced="draft.advanced" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <FieldDescription>Verbosity of kira-space's own diagnostic log, for every repository.</FieldDescription>
    </GitLogLevelField>
  </div>
</template>
