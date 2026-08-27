<script setup lang="ts">
import CodiconIcon from '../../../theme/CodiconIcon.vue';
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
/* P48 F11: the nine rules DocumentView.vue and ConsoleResultGrid.vue each declared for this row
   and its head, one of which had already drifted (`.doc-head`'s own padding, D12 — the document
   view's `--kira-s-4` is the value kept). Everything about the *expanded body* (its own wrapper
   class, its v-if gate, `.doc-preview-match`) stays per-caller in the #body slot (F13) — none of
   it is in this list. */
.doc-row {
  display: flex;
  flex-direction: column;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-head {
  height: var(--kira-h-md);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4);
  cursor: pointer;
}

.doc-head:hover {
  background: var(--kira-hover);
}

.doc-row.open > .doc-head {
  background: var(--kira-bg-elevated);
}

/* The row currently published to the cell editor (documents) or selected for the console's own
   copy — a left rail, never a full-row tint, so it stays legible under `.open`'s own background
   and a search match's highlight at the same time. */
.doc-row.selected > .doc-head {
  box-shadow: inset 2px 0 0 var(--kira-accent);
}

/* P31 D20: the same color-mix tint / solid-current pair DataGrid.vue and KeyValueView.vue use —
   a row-level tint (not `.doc-head`'s own opaque `.open` background, so `.selected`'s rail above
   still reads through it) since a document match has no single cell to point at. */
.doc-row.search-match {
  background: var(--kira-search-match);
}

.doc-row.search-match-current {
  background: var(--kira-search-match-current);
}

.expand-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0;
}

.doc-id {
  flex-shrink: 0;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
