<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import type { EditBuffer } from './useEditBuffer';

// The one visual form of the three features an edit buffer offers — the `modified` chip, the
// byte badge, Beautify/Minify and Revert — rendered identically by the cell editor's header and
// by the document row's edit-action row (P27 D27). `testidPrefix` keeps each mount's testids
// distinct without either caller inventing its own copy of this row.
const props = withDefaults(
  defineProps<{
    buffer: EditBuffer;
    revertTitle?: string;
    testidPrefix: string;
    /** Mongo's shell-literal document editor has no real use for a minified constructor-call
     *  body (`ObjectId(...)`, `ISODate(...)`) the way the cell editor's raw JSON/XML does — the
     *  Minify action is hidden there rather than offering a control that doesn't serve a purpose. */
    showCompact?: boolean;
    /** P42 D31: the cell editor's own status badge already carries a byte figure (among truncation/
     *  decoded-reading/beautify-failure notes) — this row's badge would be the same number shown
     *  twice. The document editor has no such badge, so its two mounts keep the default. */
    showBytes?: boolean;
  }>(),
  { revertTitle: undefined, showCompact: true, showBytes: true },
);

const beautifyDisabledTitle = 'Indented and compact formatting apply to JSON and XML/HTML.';
const beautifyIndentedTitle = computed<string>(() =>
  props.buffer.canBeautify.value
    ? 'Beautify — pretty-print with indentation'
    : beautifyDisabledTitle,
);
const beautifyCompactTitle = computed<string>(() =>
  props.buffer.canBeautify.value ? 'Minify — remove all whitespace' : beautifyDisabledTitle,
);
const resetTitle = computed<string>(
  () =>
    props.revertTitle ??
    (props.buffer.isDirty.value
      ? 'Revert to the stored value'
      : 'Already showing the stored value.'),
);
</script>

<template>
  <span class="edit-buffer-actions">
    <span
      v-if="buffer.isDirty.value"
      class="p-chip warn"
      :data-testid="`${testidPrefix}-modified`"
    >
      modified
    </span>
    <span v-if="showBytes" class="p-badge" :data-testid="`${testidPrefix}-byte-badge`">{{
      buffer.byteLabel.value
    }}</span>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-field text-fg': buffer.formatted.value === 'indented' }"
            aria-label="Beautify"
            :data-testid="`${testidPrefix}-beautify-indented`"
            :disabled="!buffer.canBeautify.value"
            @click="buffer.applyBeautify('indented')"
          >
            <CodiconIcon name="expand-all" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ beautifyIndentedTitle }}</TooltipContent>
    </Tooltip>
    <Tooltip v-if="showCompact">
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-field text-fg': buffer.formatted.value === 'compact' }"
            aria-label="Minify"
            :data-testid="`${testidPrefix}-beautify-compact`"
            :disabled="!buffer.canBeautify.value"
            @click="buffer.applyBeautify('compact')"
          >
            <CodiconIcon name="collapse-all" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ beautifyCompactTitle }}</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Revert"
            :data-testid="`${testidPrefix}-beautify-reset`"
            :disabled="!buffer.isDirty.value"
            @click="buffer.reset()"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ resetTitle }}</TooltipContent>
    </Tooltip>
  </span>
</template>

<style scoped>
@reference "@theme/base.css";

.edit-buffer-actions {
  @apply flex items-center shrink-0 gap-1.5;
}
</style>
