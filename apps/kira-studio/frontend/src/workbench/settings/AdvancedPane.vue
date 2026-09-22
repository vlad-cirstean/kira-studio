<script setup lang="ts">
import { EXPENSIVE_QUERY_ROWS_RANGE, OP_LOG_RETENTION_DAYS_RANGE, type Settings } from '@shared/domain/settings';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { computed } from 'vue';
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

// P72 §9.2: kira-space's own diagnostic log verbosity, moved here from the per-repo
// RepoSettingsDialog.vue's kiraVersion.log.level — genuinely installation-wide, not a per-repo
// fact, so this is now the one control that sets it.
function onGitLogLevelChange(e: Event): void {
  props.draft.advanced.gitLogLevel = (e.target as HTMLSelectElement)
    .value as Settings['advanced']['gitLogLevel'];
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
  <div class="settings-pane" v-show="active">
    <label class="field">
      <div class="field-head">
        <span>Operation log retention (days)</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-advanced-opLogRetentionDays"
          :disabled="isAtDefault('advanced', 'opLogRetentionDays')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('advanced', 'opLogRetentionDays')"
        />
      </div>
      <TextField
        type="number"
        :min="OP_LOG_RETENTION_DAYS_RANGE.min"
        :max="OP_LOG_RETENTION_DAYS_RANGE.max"
        size="md"
        :invalid="!!opLogRetentionError"
        data-testid="settings-oplog-retention"
        :model-value="String(draft.advanced.opLogRetentionDays)"
        @input="onOpLogRetentionInput"
      />
      <span v-if="opLogRetentionError" class="field-error" data-testid="settings-oplog-retention-error">
        {{ opLogRetentionError }}
      </span>
    </label>
    <p class="muted-note">Takes effect after restart.</p>

    <label class="field">
      <div class="field-head">
        <span>Expensive query threshold (rows)</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-advanced-expensiveQueryRows"
          :disabled="isAtDefault('advanced', 'expensiveQueryRows')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('advanced', 'expensiveQueryRows')"
        />
      </div>
      <TextField
        type="number"
        :min="EXPENSIVE_QUERY_ROWS_RANGE.min"
        :max="EXPENSIVE_QUERY_ROWS_RANGE.max"
        size="md"
        :invalid="!!expensiveQueryRowsError"
        data-testid="settings-expensive-query-rows"
        :model-value="String(draft.advanced.expensiveQueryRows)"
        @input="onExpensiveQueryRowsInput"
      />
      <span
        v-if="expensiveQueryRowsError"
        class="field-error"
        data-testid="settings-expensive-query-rows-error"
      >
        {{ expensiveQueryRowsError }}
      </span>
      <span v-else class="helper-text"
        >A query whose plan is estimated to read at least this many rows is flagged as
        expensive by the console's Explain button and by auto-explain. Not comparable
        across engines' own cost figures — see the plan panel's own note.</span
      >
    </label>

    <label class="field">
      <div class="field-head">
        <span>Git log level</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-advanced-gitLogLevel"
          :disabled="isAtDefault('advanced', 'gitLogLevel')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('advanced', 'gitLogLevel')"
        />
      </div>
      <select
        class="p-select bordered md"
        data-testid="settings-git-log-level"
        :value="draft.advanced.gitLogLevel"
        @change="onGitLogLevelChange"
      >
        <option value="off">Off</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
      </select>
      <span class="helper-text">Verbosity of kira-space's own diagnostic log, for every repository.</span>
    </label>
  </div>
</template>
