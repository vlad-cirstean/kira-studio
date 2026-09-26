<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription, FieldError } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import LogLevelField from '@workbench/settings/fields/LogLevelField.vue';
import { computed, useId } from 'vue';
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

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const opLogRetentionDaysId = useId();
const expensiveQueryRowsId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="opLogRetentionDaysId">Operation log retention (days)</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
          data-testid="settings-reset-advanced-opLogRetentionDays"
          :disabled-trigger="isAtDefault('advanced', 'opLogRetentionDays')"
          :disabled="isAtDefault('advanced', 'opLogRetentionDays')"
          @click="resetLeaf('advanced', 'opLogRetentionDays')"
        />
      </div>
      <NumberStepperInput
        :id="opLogRetentionDaysId"
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
    </Field>
    <p class="text-subtle text-kira-xs">Takes effect after restart.</p>

    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="expensiveQueryRowsId">Expensive query threshold (rows)</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
          data-testid="settings-reset-advanced-expensiveQueryRows"
          :disabled-trigger="isAtDefault('advanced', 'expensiveQueryRows')"
          :disabled="isAtDefault('advanced', 'expensiveQueryRows')"
          @click="resetLeaf('advanced', 'expensiveQueryRows')"
        />
      </div>
      <NumberStepperInput
        :id="expensiveQueryRowsId"
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
    </Field>

    <LogLevelField
      :advanced="draft.advanced"
      leaf="logLevel"
      label="Log level"
      select-test-id="settings-log-level"
      :is-at-default="isAtDefault"
      :reset-leaf="resetLeaf"
    >
      <FieldDescription>Verbosity of Kira Studio's own diagnostic log.</FieldDescription>
    </LogLevelField>
  </div>
</template>
