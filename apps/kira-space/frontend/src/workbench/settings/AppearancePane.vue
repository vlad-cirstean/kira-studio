<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLegend } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import DateFormatField from '@workbench/settings/fields/DateFormatField.vue';
import FontSizeField from '@workbench/settings/fields/FontSizeField.vue';
import RowDensityField from '@workbench/settings/fields/RowDensityField.vue';
import WordWrapField from '@workbench/settings/fields/WordWrapField.vue';
import { useId } from 'vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-if="activeSection === 'Appearance'"` branch — trimmed to typography + repo-file-viewer
// leaves (P100 Part 2's own comment: no row density preview, no data-grid page size, none of
// which this app has a feature for).
const props = defineProps<SettingsPaneProps>();

function onInlineBlameChange(checked: boolean): void {
  props.draft.appearance.inlineBlame = checked;
}

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const inlineBlameId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <FieldLegend class="pt-0">Typography</FieldLegend>
    <FontSizeField
      :appearance="draft.appearance"
      :is-at-default="isAtDefault"
      :reset-leaf="resetLeaf"
      :register-field-error="registerFieldError"
    />

    <RowDensityField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <FieldDescription>Applies to the file tree and every list.</FieldDescription>
    </RowDensityField>

    <WordWrapField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <FieldDescription>Long lines wrap instead of scrolling, in the file viewer.</FieldDescription>
    </WordWrapField>

    <FieldGroup>
      <Field orientation="horizontal">
        <Checkbox
          :id="inlineBlameId"
          class="size-3.5"
          :model-value="draft.appearance.inlineBlame"
          data-testid="settings-inline-blame"
          @update:model-value="(v) => onInlineBlameChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <Label :for="inlineBlameId" class="text-kira-sm">Inline blame</Label>
        <FieldDescription
          >Show who last changed the current line, at the end of that line, in the
          repository file viewer.</FieldDescription
        >
      </Field>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        class="ml-auto"
        data-testid="settings-reset-appearance-inlineBlame"
        :disabled-trigger="isAtDefault('appearance', 'inlineBlame')"
        :disabled="isAtDefault('appearance', 'inlineBlame')"
        @click="resetLeaf('appearance', 'inlineBlame')"
      />
    </FieldGroup>

    <DateFormatField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf" />
  </div>
</template>
