<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowVariants } from '@theme/components/rowVariants';
import { Badge } from '@theme/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { cn } from '@theme/lib/utils';
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
      'search-match bg-search-match': searchMatch,
      'search-match-current bg-search-match-current': searchMatchCurrent,
    }"
    :data-id="view.id"
  >
    <div
      class="doc-head"
      :class="cn(rowVariants({ layout: 'tree', selected: expanded }), 'shrink-0 cursor-pointer gap-1.5 px-2', selected && 'shadow-[inset_2px_0_0_var(--primary)]')"
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
      <span class="shrink-0 max-w-56 overflow-hidden text-ellipsis whitespace-nowrap text-fg text-kira-md font-data" data-testid="document-id">{{ view.idLabel }}</span>
      <Badge data-testid="document-field-count">{{ view.fieldCount }} fields</Badge>
      <Badge data data-testid="document-byte-badge">{{ view.byteLabel }}</Badge>
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
