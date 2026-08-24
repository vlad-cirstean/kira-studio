<script setup lang="ts">
import { computed } from 'vue';
import IconButton from '../../theme/primitives/IconButton.vue';
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
  }>(),
  { revertTitle: undefined },
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
    <span class="p-badge" :data-testid="`${testidPrefix}-byte-badge`">{{
      buffer.byteLabel.value
    }}</span>
    <IconButton
      icon="expand-all"
      :active="buffer.formatted.value === 'indented'"
      :data-testid="`${testidPrefix}-beautify-indented`"
      :disabled="!buffer.canBeautify.value"
      v-tooltip="beautifyIndentedTitle"
      @click="buffer.applyBeautify('indented')"
    />
    <IconButton
      icon="collapse-all"
      :active="buffer.formatted.value === 'compact'"
      :data-testid="`${testidPrefix}-beautify-compact`"
      :disabled="!buffer.canBeautify.value"
      v-tooltip="beautifyCompactTitle"
      @click="buffer.applyBeautify('compact')"
    />
    <IconButton
      icon="discard"
      :data-testid="`${testidPrefix}-beautify-reset`"
      :disabled="!buffer.isDirty.value"
      v-tooltip="resetTitle"
      @click="buffer.reset()"
    />
  </span>
</template>

<style scoped>
.edit-buffer-actions {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  flex-shrink: 0;
}
</style>
