<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { computed, ref } from 'vue';
import {
  EXPENSIVE_QUERY_ROWS_RANGE,
  type GitLogLevel,
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

// P72 §9.2: kira-space's own diagnostic log verbosity, moved here from the per-repo
// RepoSettingsDialog.vue's kiraVersion.log.level — genuinely installation-wide, not a per-repo
// fact, so this is now the one control that sets it.
function onGitLogLevelChange(e: Event): void {
  props.draft.advanced.gitLogLevel = (e.target as HTMLSelectElement).value as GitLogLevel;
}

// P104 §2: TextField's number stepper -> ui/input-group recipe.
const opLogRetentionGroupRef = ref<HTMLElement | null>(null);
const opLogRetentionStepper = useNumberStepper(opLogRetentionGroupRef);
const expensiveQueryRowsGroupRef = ref<HTMLElement | null>(null);
const expensiveQueryRowsStepper = useNumberStepper(expensiveQueryRowsGroupRef);

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
    <Label class="field">
      <div class="field-head">
        <span>Operation log retention (days)</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('advanced', 'opLogRetentionDays') }">
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
            </span>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <span ref="opLogRetentionGroupRef" class="contents">
        <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
          <InputGroupInput
            type="number"
            :min="OP_LOG_RETENTION_DAYS_RANGE.min"
            :max="OP_LOG_RETENTION_DAYS_RANGE.max"
            class="h-full font-data"
            :aria-invalid="!!opLogRetentionError || undefined"
            data-testid="settings-oplog-retention"
            :model-value="String(draft.advanced.opLogRetentionDays)"
            @input="onOpLogRetentionInput"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  @mousedown.prevent="opLogRetentionStepper.stepBy(1)"
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
                  @mousedown.prevent="opLogRetentionStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </span>
      <span v-if="opLogRetentionError" class="field-error" data-testid="settings-oplog-retention-error">
        {{ opLogRetentionError }}
      </span>
    </Label>
    <p class="muted-note">Takes effect after restart.</p>

    <Label class="field">
      <div class="field-head">
        <span>Expensive query threshold (rows)</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('advanced', 'expensiveQueryRows') }">
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
            </span>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <span ref="expensiveQueryRowsGroupRef" class="contents">
        <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
          <InputGroupInput
            type="number"
            :min="EXPENSIVE_QUERY_ROWS_RANGE.min"
            :max="EXPENSIVE_QUERY_ROWS_RANGE.max"
            class="h-full font-data"
            :aria-invalid="!!expensiveQueryRowsError || undefined"
            data-testid="settings-expensive-query-rows"
            :model-value="String(draft.advanced.expensiveQueryRows)"
            @input="onExpensiveQueryRowsInput"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  @mousedown.prevent="expensiveQueryRowsStepper.stepBy(1)"
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
                  @mousedown.prevent="expensiveQueryRowsStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </span>
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
    </Label>

    <Label class="field">
      <div class="field-head">
        <span>Git log level</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('advanced', 'gitLogLevel') }">
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="settings-reset-advanced-gitLogLevel"
                :disabled="isAtDefault('advanced', 'gitLogLevel')"
                aria-label="Reset to default"
                @click="resetLeaf('advanced', 'gitLogLevel')"
              >
                <CodiconIcon name="discard" :size="13" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
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
    </Label>
  </div>
</template>
