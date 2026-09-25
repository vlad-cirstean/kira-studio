<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
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
  <span class="flex items-center shrink-0 gap-1.5">
    <Badge
      v-if="buffer.isDirty.value"
      variant="warn"
      :data-testid="`${testidPrefix}-modified`"
    >
      modified
    </Badge>
    <Badge v-if="showBytes" :data-testid="`${testidPrefix}-byte-badge`">{{
      buffer.byteLabel.value
    }}</Badge>
    <TooltipIconButton
      icon="expand-all"
      :label="beautifyIndentedTitle"
      aria-label="Beautify"
      disabled-trigger
      :class="{ 'bg-field text-fg': buffer.formatted.value === 'indented' }"
      :data-testid="`${testidPrefix}-beautify-indented`"
      :disabled="!buffer.canBeautify.value"
      @click="buffer.applyBeautify('indented')"
    />
    <TooltipIconButton
      v-if="showCompact"
      icon="collapse-all"
      :label="beautifyCompactTitle"
      aria-label="Minify"
      disabled-trigger
      :class="{ 'bg-field text-fg': buffer.formatted.value === 'compact' }"
      :data-testid="`${testidPrefix}-beautify-compact`"
      :disabled="!buffer.canBeautify.value"
      @click="buffer.applyBeautify('compact')"
    />
    <TooltipIconButton
      icon="discard"
      :label="resetTitle"
      aria-label="Revert"
      disabled-trigger
      :data-testid="`${testidPrefix}-beautify-reset`"
      :disabled="!buffer.isDirty.value"
      @click="buffer.reset()"
    />
  </span>
</template>
