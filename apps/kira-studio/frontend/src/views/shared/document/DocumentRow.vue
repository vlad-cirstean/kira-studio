<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import type { DocumentRowView } from './rows';

// P48 F10-F12: the Mongo document row's head — down to its five shared data-testids — duplicated
// between DocumentView.vue and ConsoleResultGrid.vue's own read-only copy. The expansion *state*
// behind `expanded` stays genuinely different per caller (documents: persisted, default-expanded,
// P27 D2; console: runtime-only, default-collapsed, P42 D11) — this component only renders the
// row that reads it. `scope` names the tab id or console result key the caller resolved `view`
// against (rows.ts's own registered-source key), for a caller that needs it alongside `view.id`.
defineProps<{
  view: DocumentRowView;
  scope: string;
  expanded: boolean;
  selected: boolean;
  searchMatch: boolean;
  searchMatchCurrent: boolean;
}>();

defineEmits<{ toggle: []; select: [] }>();
</script>

<template>
  <div
    class="doc-row"
    :class="{
      open: expanded,
      selected,
      'search-match': searchMatch,
      'search-match-current': searchMatchCurrent,
    }"
    :data-id="view.id"
  >
    <div class="doc-head" @click="$emit('select')">
      <button
        type="button"
        class="expand-toggle"
        data-testid="document-toggle-expand"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="$emit('toggle')"
      >
        <CodiconIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
      </button>
      <span class="doc-id" data-testid="document-id">{{ view.idLabel }}</span>
      <span class="p-badge" data-testid="document-field-count">{{ view.fieldCount }} fields</span>
      <span class="p-badge" data-testid="document-byte-badge">{{ view.byteLabel }}</span>
      <span
        v-if="view.isTruncated"
        class="p-badge warn"
        v-tooltip="'value truncated'"
        data-testid="document-truncated"
        >truncated</span
      >
      <slot name="actions" />
    </div>
    <slot name="body" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P48 F11: the nine rules DocumentView.vue and ConsoleResultGrid.vue each declared for this row
   and its head, one of which had already drifted (`.doc-head`'s own padding, D12 — the document
   view's `--kira-s-4` is the value kept). Everything about the *expanded body* (its own wrapper
   class, its v-if gate, `.doc-preview-match`) stays per-caller in the #body slot (F13) — none of
   it is in this list. */
.doc-row {
  @apply flex flex-col border-b border-border;
}

.doc-head {
  @apply flex shrink-0 items-center cursor-pointer gap-[var(--kira-s-3)] px-[var(--kira-s-4)] h-[var(--kira-h-md)];
}

.doc-head:hover {
  @apply bg-hover;
}

.doc-row.open > .doc-head {
  @apply bg-elevated;
}

/* The row currently published to the cell editor (documents) or selected for the console's own
   copy — a left rail, never a full-row tint, so it stays legible under `.open`'s own background
   and a search match's highlight at the same time. */
.doc-row.selected > .doc-head {
  @apply shadow-[inset_2px_0_0_var(--kira-accent)];
}

/* P31 D20: the same color-mix tint / solid-current pair KeyValueView.vue uses (and the deleted
   DataGrid.vue used) —
   a row-level tint (not `.doc-head`'s own opaque `.open` background, so `.selected`'s rail above
   still reads through it) since a document match has no single cell to point at. */
.doc-row.search-match {
  background: var(--kira-search-match);
}

.doc-row.search-match-current {
  background: var(--kira-search-match-current);
}

.expand-toggle {
  @apply flex shrink-0 items-center justify-center cursor-pointer border-0 bg-transparent p-0 text-muted;
}

.doc-id {
  @apply shrink-0 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap text-fg text-[length:var(--kira-t-md)] font-[family-name:var(--kira-font-data)];
}
</style>
