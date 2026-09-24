<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { FieldDescription, FieldError, FieldGroup, FieldLegend, fieldVariants } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import DateFormatField from '@workbench/settings/fields/DateFormatField.vue';
import FontSizeField from '@workbench/settings/fields/FontSizeField.vue';
import RowDensityField from '@workbench/settings/fields/RowDensityField.vue';
import WordWrapField from '@workbench/settings/fields/WordWrapField.vue';
import { computed } from 'vue';
import { FONT_CHOICES, fontStackAvailable, resolveFontFallback } from '../../fonts';
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

function onRowColoringChange(checked: boolean): void {
  props.draft.appearance.rowColoring = checked;
}

function onInlineBlameChange(checked: boolean): void {
  props.draft.appearance.inlineBlame = checked;
}

const rowPreviewHeight = computed(() => (props.draft.appearance.rowDensity === 'compact' ? 22 : 28));
</script>

<template>
  <div class="contents" v-show="active">
    <FieldLegend class="pt-0">Typography</FieldLegend>
    <Label :class="fieldVariants()">
      <div class="flex items-center justify-between gap-1">
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
      <FieldError v-if="fontFamilyUnavailable" data-testid="font-unavailable">
        Not installed<template v-if="fontFamilyFallback">
          — text falls back to the browser's {{ fontFamilyFallback }} default.</template
        ><template v-else> — text falls back to the browser's default.</template>
      </FieldError>
      <FieldDescription v-else>Grid cells, editors, anything that came out of a database.</FieldDescription>
    </Label>

    <FontSizeField
      :appearance="draft.appearance"
      :is-at-default="isAtDefault"
      :reset-leaf="resetLeaf"
      :register-field-error="registerFieldError"
    />

    <RowDensityField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <FieldDescription>Applies to the tree, the grid and every list.</FieldDescription>
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
    </RowDensityField>

    <WordWrapField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <FieldDescription
        >Long lines wrap instead of scrolling — the query console, the Mongo console and
        the cell editor.</FieldDescription
      >
    </WordWrapField>

    <FieldGroup>
      <Label data-slot="field" :class="fieldVariants({ orientation: 'horizontal' })">
        <Checkbox
          class="size-3.5"
          :model-value="draft.appearance.rowColoring"
          data-testid="settings-row-coloring"
          @update:model-value="(v) => onRowColoringChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Row colouring</span>
        <FieldDescription
          >Colour grid values by their column's data type. Off renders every row in the
          plain text colour.</FieldDescription
        >
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'rowColoring') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="ml-auto"
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
    </FieldGroup>

    <FieldGroup>
      <Label data-slot="field" :class="fieldVariants({ orientation: 'horizontal' })">
        <Checkbox
          class="size-3.5"
          :model-value="draft.appearance.inlineBlame"
          data-testid="settings-inline-blame"
          @update:model-value="(v) => onInlineBlameChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Inline blame</span>
        <FieldDescription
          >Show who last changed the current line, at the end of that line, in the
          repository file viewer.</FieldDescription
        >
      </Label>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('appearance', 'inlineBlame') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="ml-auto"
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
    </FieldGroup>

    <DateFormatField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf" />
  </div>
</template>
