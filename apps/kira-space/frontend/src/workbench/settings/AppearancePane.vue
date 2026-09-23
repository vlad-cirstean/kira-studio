<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
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
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-if="activeSection === 'Appearance'"` branch — trimmed to typography + repo-file-viewer
// leaves (P100 Part 2's own comment: no row density preview, no data-grid page size, none of
// which this app has a feature for).
const props = defineProps<SettingsPaneProps>();

function onInlineBlameChange(checked: boolean): void {
  props.draft.appearance.inlineBlame = checked;
}
</script>

<template>
  <div class="settings-pane" v-show="active">
    <div class="sec-label first">Typography</div>
    <FontSizeField
      :appearance="draft.appearance"
      :is-at-default="isAtDefault"
      :reset-leaf="resetLeaf"
      :register-field-error="registerFieldError"
    />

    <RowDensityField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <span class="helper-text">Applies to the file tree and every list.</span>
    </RowDensityField>

    <WordWrapField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <span class="helper-text">Long lines wrap instead of scrolling, in the file viewer.</span>
    </WordWrapField>

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

    <DateFormatField :appearance="draft.appearance" :is-at-default="isAtDefault" :reset-leaf="resetLeaf" />
  </div>
</template>
