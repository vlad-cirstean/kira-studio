<script setup lang="ts">
import Checkbox from '@theme/primitives/Checkbox.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { computed } from 'vue';
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
</script>

<template>
  <div class="settings-pane" v-show="active">
    <div class="sec-label first">Typography</div>
    <label class="field">
      <div class="field-head">
        <span>Data font size</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-appearance-fontSize"
          :disabled="isAtDefault('appearance', 'fontSize')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('appearance', 'fontSize')"
        />
      </div>
      <div class="size-input">
        <TextField
          type="number"
          :min="FONT_SIZE_RANGE.min"
          :max="FONT_SIZE_RANGE.max"
          size="md"
          :invalid="!!fontSizeError"
          data-testid="settings-font-size"
          :model-value="String(draft.appearance.fontSize)"
          @input="onFontSizeInput"
        />
      </div>
      <span v-if="fontSizeError" class="field-error" data-testid="settings-font-size-error">
        {{ fontSizeError }}
      </span>
      <span v-else class="helper-text"
        >{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span
      >
    </label>

    <div class="field">
      <div class="field-head">
        <span>Row height</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-appearance-rowDensity"
          :disabled="isAtDefault('appearance', 'rowDensity')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('appearance', 'rowDensity')"
        />
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
      <label class="field checkbox">
        <Checkbox
          :model-value="draft.appearance.wordWrap"
          data-testid="settings-word-wrap"
          @update:model-value="onWordWrapChange"
        />
        <span>Word wrap</span>
        <span class="helper-text">Long lines wrap instead of scrolling, in the file viewer.</span>
      </label>
      <IconButton
        icon="discard"
        class="p-push"
        data-testid="settings-reset-appearance-wordWrap"
        :disabled="isAtDefault('appearance', 'wordWrap')"
        v-tooltip="'Reset to default'"
        @click="resetLeaf('appearance', 'wordWrap')"
      />
    </div>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="draft.appearance.inlineBlame"
          data-testid="settings-inline-blame"
          @update:model-value="onInlineBlameChange"
        />
        <span>Inline blame</span>
        <span class="helper-text"
          >Show who last changed the current line, at the end of that line, in the
          repository file viewer.</span
        >
      </label>
      <IconButton
        icon="discard"
        class="p-push"
        data-testid="settings-reset-appearance-inlineBlame"
        :disabled="isAtDefault('appearance', 'inlineBlame')"
        v-tooltip="'Reset to default'"
        @click="resetLeaf('appearance', 'inlineBlame')"
      />
    </div>

    <label class="field">
      <div class="field-head">
        <span>Commit date</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-appearance-dateFormat"
          :disabled="isAtDefault('appearance', 'dateFormat')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('appearance', 'dateFormat')"
        />
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
    </label>
  </div>
</template>
