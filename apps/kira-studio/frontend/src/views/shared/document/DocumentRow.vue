<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import type { DocumentRowView } from './rows';

// P48 F10-F12: the Mongo document row's head — down to its five shared data-testids — duplicated
// between DocumentView.vue and ConsoleResultGrid.vue's own read-only copy. The expansion *state*
// behind `expanded` stays genuinely different per caller (documents: persisted, default-expanded,
// P27 D2; console: runtime-only, default-collapsed, P42 D11) — this component only renders the
// row that reads it. `rowScope` names the tab id or console result key the caller resolved `view`
// against (rows.ts's own registered-source key), for a caller that needs it alongside `view.id`.
// P105 §13: named `rowScope`, not `scope` — the HTML global `scope` attribute name collides with
// Biome's `noHeaderScope`, which reads the attribute name off every call site that binds it.
defineProps<{
  view: DocumentRowView;
  rowScope: string;
  expanded: boolean;
  selected: boolean;
  searchMatch: boolean;
  searchMatchCurrent: boolean;
}>();

const emit = defineEmits<{ toggle: []; select: [] }>();

// P105 §5.2(c): Enter/Space mirror a single click — the expand-toggle button and the #actions
// slot's own controls stay their own tab stops, so this handler never claims either key from them.
function onHeadKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  emit('select');
}
</script>

<template>
  <div
    class="doc-row flex flex-col border-b border-border"
    :class="{
      open: expanded,
      selected,
      'search-match bg-search-match': searchMatch,
      'search-match-current bg-search-match-current': searchMatchCurrent,
    }"
    :data-id="view.id"
  >
    <div
      class="doc-head flex shrink-0 items-center cursor-pointer gap-1.5 px-2 h-6.5"
      role="option"
      tabindex="0"
      :aria-selected="selected"
      @click="$emit('select')"
      @keydown="onHeadKeydown"
    >
      <button
        type="button"
        class="flex shrink-0 items-center justify-center cursor-pointer border-0 bg-transparent p-0 text-muted-foreground"
        data-testid="document-toggle-expand"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="$emit('toggle')"
      >
        <CodiconIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
      </button>
      <span class="shrink-0 max-w-56 overflow-hidden text-ellipsis whitespace-nowrap text-fg text-kira-md font-[family-name:var(--kira-font-data)]" data-testid="document-id">{{ view.idLabel }}</span>
      <Badge data-testid="document-field-count">{{ view.fieldCount }} fields</Badge>
      <Badge data-testid="document-byte-badge">{{ view.byteLabel }}</Badge>
      <Tooltip v-if="view.isTruncated">
        <TooltipTrigger as-child>
          <Badge variant="warn" data-testid="document-truncated">truncated</Badge>
        </TooltipTrigger>
        <TooltipContent>value truncated</TooltipContent>
      </Tooltip>
      <slot name="actions" />
    </div>
    <slot name="body" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";
/* P110 B40: every plain single-selector rule this file had moved onto the template as Tailwind
   utilities. `.doc-row`/`.doc-head` stay bare markers to anchor these compounds. */
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
  @apply shadow-[inset_2px_0_0_var(--primary)];
}

/* P31 D20: the same color-mix tint / solid-current pair KeyValueView.vue uses (and the deleted
   DataGrid.vue used) —
   a row-level tint (not `.doc-head`'s own opaque `.open` background, so `.selected`'s rail above
   still reads through it) since a document match has no single cell to point at.
   P110 B34: `.search-match`/`.search-match-current` above carry no rule of their own any more --
   bare marker classes now, the tint itself is `bg-search-match[-current]` alongside them
   (--color-search-match[-current] already @theme-registered, base.css). Deliberately no `text-bg`
   here (unlike KeyValuePane.vue/ConsoleResultGrid.vue's own -current pairing): this row's current-
   match state was never given a text-colour change, only the background -- kept exact. */
</style>
