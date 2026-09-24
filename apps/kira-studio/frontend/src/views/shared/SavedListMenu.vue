<script setup lang="ts" generic="Entry extends { id: string }">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { PopoverContent } from '@theme/components/ui/popover';
import { Separator } from '@theme/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';

// Shared popover shell for views/shared/FilterHistoryMenu.vue and console/ConsoleSavedMenu.vue: both are
// a "Saved" list (pin/rename/delete an entry, click to apply it) with an optional "Recent" list
// underneath (click-to-apply only — history entries can't be pinned, renamed or deleted). Every
// bit of per-caller business logic (what "apply"/"pin"/"delete" actually do, the rename prompt,
// the "save current …" action) stays in the caller; this component only owns the shell, the two
// list sections, and the pin/delete affordances that are identical in both call sites.
//
// `Entry` is left otherwise unconstrained (beyond the `id` used for :key) so each caller can pass
// its own saved/recent shape — SavedFilterQuery + FilterHistoryEntry for the grid, SavedConsoleQuery
// alone for the console. Because a "recent" entry doesn't necessarily carry a `pinned` field,
// pin state is derived by duck-typing rather than requiring it on Entry.
defineProps<{
  /** Label for the saved section, e.g. "Saved" or "Saved queries". */
  title: string;
  saved: readonly Entry[];
  /** Omit entirely (undefined) to hide the "Recent" section — the console has no history list. */
  recent?: readonly Entry[];
  panelTestId: string;
  savedEntryTestId: string;
  recentEntryTestId?: string;
  emptySavedText: string;
  emptyRecentText?: string;
}>();

const emit = defineEmits<{
  apply: [entry: Entry];
  togglePin: [entry: Entry];
  delete: [entry: Entry];
}>();

// P105 §5.2(c): Enter/Space mirror a single click — the pin/delete buttons nested inside a saved
// row stay their own tab stops, so this handler never claims either key from them.
function onRowKeydown(e: KeyboardEvent, entry: Entry): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  emit('apply', entry);
}

function isPinned(entry: Entry): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'pinned' in entry &&
    Boolean((entry as { pinned?: unknown }).pinned)
  );
}

defineSlots<{
  entry(props: { entry: Entry }): unknown;
  'entry-actions'?(props: { entry: Entry }): unknown;
  footer?(props: Record<string, never>): unknown;
}>();
</script>

<template>
  <PopoverContent align="start" class="w-80 gap-0 p-0" :data-testid="panelTestId">
    <div class="saved-list-menu-inner">
      <div class="p-menu-label">{{ title }}</div>
      <div v-if="saved.length === 0" class="empty-row p-sm text-subtle">{{ emptySavedText }}</div>
      <div v-else role="listbox" :aria-label="title">
        <div
          v-for="entry in saved"
          :key="entry.id"
          class="entry-row p-row"
          :data-testid="savedEntryTestId"
          role="option"
          tabindex="0"
          @click="emit('apply', entry)"
          @keydown="onRowKeydown($event, entry)"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="pin-button"
                :class="{ pinned: isPinned(entry) }"
                @click.stop="emit('togglePin', entry)"
              >
                <CodiconIcon :name="isPinned(entry) ? 'star-full' : 'star-empty'" :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Pin</TooltipContent>
          </Tooltip>
          <slot name="entry" :entry="entry" />
          <span class="entry-actions">
            <slot name="entry-actions" :entry="entry" />
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="toolbar" size="kira-icon" aria-label="Delete" @click.stop="emit('delete', entry)">
                  <CodiconIcon name="trash" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </span>
        </div>
      </div>

      <template v-if="recent">
        <Separator class="my-1" />
        <div class="p-menu-label">Recent</div>
        <div v-if="recent.length === 0" class="empty-row p-sm text-subtle">{{ emptyRecentText }}</div>
        <div v-else role="listbox" aria-label="Recent">
          <div
            v-for="entry in recent"
            :key="entry.id"
            class="entry-row p-row"
            :data-testid="recentEntryTestId"
            role="option"
            tabindex="0"
            @click="emit('apply', entry)"
            @keydown="onRowKeydown($event, entry)"
          >
            <slot name="entry" :entry="entry" />
          </div>
        </div>
      </template>

      <slot name="footer" />
    </div>
  </PopoverContent>
</template>

<style scoped>
@reference "@theme/base.css";

.saved-list-menu-inner {
  @apply max-h-100 overflow-y-auto;
}

.empty-row {
  @apply py-1 px-1.5;
}

.entry-row {
  @apply cursor-pointer;
}

/* flex-1/overflow-hidden/text-ellipsis/whitespace-nowrap used to live here as a single
   :slotted(.entry-name) rule, but reka-ui's TooltipTrigger `as-child` clones the slotted vnode
   (every caller wraps its entry-name span in a Tooltip, for the full-text-on-hover P31 D27/F27
   behavior) without carrying Vue's slotted-content scope-id marker, so the rule silently never
   matched — the row's flex children packed left instead of stretching, and its geometric center
   (what a real click/tap lands on) fell on the trailing action buttons instead of the row's own
   content (console.spec.ts's saved-query-apply scenario caught it). Each caller now applies these
   Tailwind classes directly on its own entry-name span instead. */

.pin-button {
  @apply flex shrink-0 cursor-pointer border-0 bg-transparent p-0 text-subtle;
}

.pin-button.pinned {
  @apply text-warn;
}

.entry-actions {
  @apply flex shrink-0 gap-0.5;
}
</style>
