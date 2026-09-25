<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { FieldDescription, FieldError, FieldGroup, FieldLegend, fieldVariants } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
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

function onFontFamilyChange(value: unknown): void {
  props.draft.appearance.fontFamily = String(value);
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
      <NativeSelect
        variant="bordered"
        size="kira-lg"
        data-testid="settings-font-family"
        :model-value="draft.appearance.fontFamily"
        @update:model-value="onFontFamilyChange"
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
      </NativeSelect>
      <span
        class="overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm text-fg"
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
      <!-- P110 B36: every cell below carries the full computed style of the old shared
           .row-preview-cell/.row-preview-gutter/.row-preview-grow/.row-preview-head rules, resolved
           per-instance rather than stacking conflicting same-property utilities (§1.3) -- the head
           row's `.row-preview-head .row-preview-cell` descendant selector outranked the gutter/grow
           siblings' own color/font-size on specificity alone, and .row-preview-grow's flex-1 always
           beat .row-preview-cell's own flex-basis by source order. That descendant selector's own
           `font-family: inherit` is dropped rather than ported: none of these 3 header cells carry
           font-data (unlike their data-row counterparts below), so they already inherit naturally
           -- porting `inherit` as a class would just re-state the default. -->
      <div class="overflow-hidden rounded-kira-sm border border-border">
        <div class="flex bg-elevated border-b border-border-strong">
          <span
            class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-9 justify-end text-muted-foreground text-kira-sm bg-elevated"
            :style="{ height: `${rowPreviewHeight}px` }"
          />
          <span
            class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-37.5 text-muted-foreground text-kira-sm"
            :style="{ height: `${rowPreviewHeight}px` }"
            >id</span
          >
          <span
            class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-1 text-muted-foreground text-kira-sm"
            :style="{ height: `${rowPreviewHeight}px` }"
            >email</span
          >
        </div>
        <div class="flex" :style="{ height: `${rowPreviewHeight}px` }">
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-9 justify-end text-subtle text-kira-xs bg-elevated font-data"
            >1</span
          >
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-37.5 text-fg text-kira-md font-data"
            >c1d0-88ae</span
          >
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-1 text-fg text-kira-md font-data"
            >rowan.brooks@example.com</span
          >
        </div>
        <div class="flex border-t border-border" :style="{ height: `${rowPreviewHeight}px` }">
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-9 justify-end text-subtle text-kira-xs bg-elevated font-data"
            >2</span
          >
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-none basis-37.5 text-fg text-kira-md font-data"
            >7f2b-19cd</span
          >
          <span class="flex items-center overflow-hidden whitespace-nowrap text-ellipsis px-2 border-r border-border flex-1 text-fg text-kira-md font-data"
            >amari.osei@example.com</span
          >
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
