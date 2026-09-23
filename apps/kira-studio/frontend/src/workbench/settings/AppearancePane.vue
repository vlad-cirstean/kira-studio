<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { computed, ref } from 'vue';
import { FONT_CHOICES, fontStackAvailable, resolveFontFallback } from '../../fonts';
import {
  type AppearanceSettings,
  FONT_SIZE_RANGE,
  type RowDensity,
} from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Appearance'"` branch — markup, classes and data-testids unchanged.
const props = defineProps<SettingsPaneProps>();

const fontFamilyUnavailable = computed(() => !fontStackAvailable(props.draft.appearance.fontFamily));
const fontFamilyFallback = computed(() => resolveFontFallback(props.draft.appearance.fontFamily));

// P28 §1.2: computed once — fontStackAvailable's canvas probe is a per-call measurement, but the
// pane is created on open and destroyed on close (P17 D1), so no invalidation is needed for its
// lifetime.
const availableStacks = computed(() => {
  const on = FONT_CHOICES.filter((f) => fontStackAvailable(f.stack));
  const off = FONT_CHOICES.filter((f) => !fontStackAvailable(f.stack));
  return { on, off };
});

// An already-stored value outside FONT_CHOICES must not be silently discarded by the dropdown —
// prepended as its own "Current" option so the select always has a matching value.
const currentFontIsListed = computed(() =>
  FONT_CHOICES.some((f) => f.stack === props.draft.appearance.fontFamily),
);

function onFontFamilyChange(e: Event): void {
  props.draft.appearance.fontFamily = (e.target as HTMLSelectElement).value;
}

function onFontSizeInput(e: Event): void {
  props.draft.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

function setRowDensity(density: RowDensity): void {
  props.draft.appearance.rowDensity = density;
}

function onWordWrapChange(checked: boolean): void {
  props.draft.appearance.wordWrap = checked;
}

function onRowColoringChange(checked: boolean): void {
  props.draft.appearance.rowColoring = checked;
}

function onInlineBlameChange(checked: boolean): void {
  props.draft.appearance.inlineBlame = checked;
}

// P72 §9.1: relative-vs-absolute commit timestamps in the git graph, moved here from the per-repo
// RepoSettingsDialog.vue — a reading preference about the person, not the repository.
function onDateFormatChange(e: Event): void {
  props.draft.appearance.dateFormat = (e.target as HTMLSelectElement)
    .value as AppearanceSettings['dateFormat'];
}

const rowPreviewHeight = computed(() => (props.draft.appearance.rowDensity === 'compact' ? 22 : 28));

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
        <span>Data font</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'fontFamily') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-appearance-fontFamily"
              :disabled="isAtDefault('appearance', 'fontFamily')"
              aria-label="Reset to default"
              @click="resetLeaf('appearance', 'fontFamily')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <select
        class="p-select bordered md"
        data-testid="settings-font-family"
        :value="draft.appearance.fontFamily"
        @change="onFontFamilyChange"
      >
        <optgroup v-if="!currentFontIsListed" label="Current">
          <option :value="draft.appearance.fontFamily">{{ draft.appearance.fontFamily }}</option>
        </optgroup>
        <optgroup label="On this Mac">
          <option
            v-for="f in availableStacks.on"
            :key="f.stack"
            :value="f.stack"
            :style="{ fontFamily: f.stack }"
          >
            {{ f.label }}
          </option>
        </optgroup>
        <optgroup label="Not installed">
          <option
            v-for="f in availableStacks.off"
            :key="f.stack"
            :value="f.stack"
            :style="{ fontFamily: f.stack }"
          >
            {{ f.label }}
          </option>
        </optgroup>
      </select>
      <span
        class="font-preview"
        data-testid="font-preview"
        :style="{ fontFamily: draft.appearance.fontFamily }"
        >The quick brown fox jumps over the lazy dog — 0123456789</span
      >
      <span v-if="fontFamilyUnavailable" class="field-error" data-testid="font-unavailable">
        Not installed<template v-if="fontFamilyFallback">
          — text falls back to the browser's {{ fontFamilyFallback }} default.</template
        ><template v-else> — text falls back to the browser's default.</template>
      </span>
      <span v-else class="helper-text">Grid cells, editors, anything that came out of a database.</span>
    </Label>

    <Label class="field">
      <div class="field-head">
        <span>Data font size</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'fontSize') }">
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
          </TooltipDisabledTrigger>
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
      <span v-else class="helper-text">{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span>
    </Label>

    <div class="field">
      <div class="field-head">
        <span>Row height</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'rowDensity') }">
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
          </TooltipDisabledTrigger>
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
      <span class="helper-text">Applies to the tree, the grid and every list.</span>
      <div class="row-preview">
        <div class="row-preview-row row-preview-head">
          <span class="row-preview-cell row-preview-gutter" :style="{ height: `${rowPreviewHeight}px` }" />
          <span class="row-preview-cell" :style="{ height: `${rowPreviewHeight}px` }">id</span>
          <span class="row-preview-cell row-preview-grow" :style="{ height: `${rowPreviewHeight}px` }">email</span>
        </div>
        <div class="row-preview-row" :style="{ height: `${rowPreviewHeight}px` }">
          <span class="row-preview-cell row-preview-gutter">1</span>
          <span class="row-preview-cell">c1d0-88ae</span>
          <span class="row-preview-cell row-preview-grow">rowan.brooks@example.com</span>
        </div>
        <div class="row-preview-row" :style="{ height: `${rowPreviewHeight}px` }">
          <span class="row-preview-cell row-preview-gutter">2</span>
          <span class="row-preview-cell">7f2b-19cd</span>
          <span class="row-preview-cell row-preview-grow">amari.osei@example.com</span>
        </div>
      </div>
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
        <span class="helper-text"
          >Long lines wrap instead of scrolling — the query console, the Mongo console and
          the cell editor.</span
        >
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'wordWrap') }">
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
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          class="size-3.5"
          :model-value="draft.appearance.rowColoring"
          data-testid="settings-row-coloring"
          @update:model-value="(v) => onRowColoringChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Row colouring</span>
        <span class="helper-text"
          >Colour grid values by their column's data type. Off renders every row in the
          plain text colour.</span
        >
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'rowColoring') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-appearance-rowColoring"
            :disabled="isAtDefault('appearance', 'rowColoring')"
            aria-label="Reset to default"
            @click="resetLeaf('appearance', 'rowColoring')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
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
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'inlineBlame') }">
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
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>

    <Label class="field">
      <div class="field-head">
        <span>Commit date</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'dateFormat') }">
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
          </TooltipDisabledTrigger>
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
