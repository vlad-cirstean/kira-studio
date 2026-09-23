<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { computed, ref } from 'vue';
import {
  type AppearanceSettings,
  FONT_SIZE_RANGE,
  type RowDensity,
} from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-if="activeSection === 'Appearance'"` branch — trimmed to typography + repo-file-viewer
// leaves (P100 Part 2's own comment: no row density preview, no data-grid page size, none of
// which this app has a feature for).
const props = defineProps<SettingsPaneProps>();

function onFontSizeInput(e: Event): void {
  props.draft.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

function setRowDensity(density: RowDensity): void {
  props.draft.appearance.rowDensity = density;
}

function onWordWrapChange(checked: boolean): void {
  props.draft.appearance.wordWrap = checked;
}

function onInlineBlameChange(checked: boolean): void {
  props.draft.appearance.inlineBlame = checked;
}

// P72 §9.1: relative-vs-absolute commit timestamps in the git graph.
function onDateFormatChange(e: Event): void {
  props.draft.appearance.dateFormat = (e.target as HTMLSelectElement)
    .value as AppearanceSettings['dateFormat'];
}

// P17 D6: the draft accepts whatever is typed (@input, so the field never fights the user
// mid-keystroke) — validity is derived here, not enforced at write time, and gates Save via
// registerFieldError below.
const fontSizeError = computed<string | null>(() => {
  const v = props.draft.appearance.fontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});
props.registerFieldError('appearance.fontSize', fontSizeError);

// P104 §2: TextField's number stepper -> ui/input-group recipe.
const fontSizeGroupRef = ref<HTMLElement | null>(null);
const fontSizeStepper = useNumberStepper(fontSizeGroupRef);
</script>

<template>
  <div class="settings-pane" v-show="active">
    <div class="sec-label first">Typography</div>
    <Label class="field">
      <div class="field-head">
        <span>Data font size</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('appearance', 'fontSize') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-fontSize"
              :disabled="isAtDefault('appearance', 'fontSize')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'fontSize')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <div class="size-input" ref="fontSizeGroupRef">
        <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
          <InputGroupInput
            type="number"
            :min="FONT_SIZE_RANGE.min"
            :max="FONT_SIZE_RANGE.max"
            class="h-full font-data"
            :aria-invalid="!!fontSizeError || undefined"
            data-testid="settings-font-size"
            :model-value="String(draft.appearance.fontSize)"
            @input="onFontSizeInput"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  @mousedown.prevent="fontSizeStepper.stepBy(1)"
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
                  @mousedown.prevent="fontSizeStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <span v-if="fontSizeError" class="field-error" data-testid="settings-font-size-error">
        {{ fontSizeError }}
      </span>
      <span v-else class="helper-text"
        >{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span
      >
    </Label>

    <div class="field">
      <div class="field-head">
        <span>Row height</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('appearance', 'rowDensity') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-rowDensity"
              :disabled="isAtDefault('appearance', 'rowDensity')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'rowDensity')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <div class="segmented">
        <button
          type="button"
          :class="{ active: draft.appearance.rowDensity === 'compact' }"
          @click="setRowDensity('compact')"
        >
          Compact · 22 px
        </button>
        <button
          type="button"
          :class="{ active: draft.appearance.rowDensity === 'comfortable' }"
          @click="setRowDensity('comfortable')"
        >
          Comfortable · 28 px
        </button>
      </div>
      <span class="helper-text">Applies to the file tree and every list.</span>
    </div>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          class="size-3.5"
          :model-value="draft.appearance.wordWrap"
          data-testid="settings-word-wrap"
          @update:model-value="(v) => onWordWrapChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Word wrap</span>
        <span class="helper-text">Long lines wrap instead of scrolling, in the file viewer.</span>
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('appearance', 'wordWrap') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-appearance-wordWrap"
            :disabled="isAtDefault('appearance', 'wordWrap')"
            aria-label="Reset to default"
            @click="resetLeaf('appearance', 'wordWrap')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          class="size-3.5"
          :model-value="draft.appearance.inlineBlame"
          data-testid="settings-inline-blame"
          @update:model-value="(v) => onInlineBlameChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Inline blame</span>
        <span class="helper-text"
          >Show who last changed the current line, at the end of that line, in the
          repository file viewer.</span
        >
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('appearance', 'inlineBlame') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-appearance-inlineBlame"
            :disabled="isAtDefault('appearance', 'inlineBlame')"
            aria-label="Reset to default"
            @click="resetLeaf('appearance', 'inlineBlame')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>

    <Label class="field">
      <div class="field-head">
        <span>Commit date</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('appearance', 'dateFormat') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-dateFormat"
              :disabled="isAtDefault('appearance', 'dateFormat')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'dateFormat')"
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
        data-testid="settings-date-format"
        :value="draft.appearance.dateFormat"
        @change="onDateFormatChange"
      >
        <option value="relative">Relative (3 days ago)</option>
        <option value="absolute">Absolute (2024-12-30 22:48)</option>
      </select>
      <span class="helper-text">The git graph's own commit timestamps.</span>
    </Label>
  </div>
</template>
