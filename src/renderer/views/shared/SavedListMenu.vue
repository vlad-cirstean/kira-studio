<script setup lang="ts" generic="Entry extends { id: string }">
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';

// Shared popover shell for grid/FilterHistoryMenu.vue and console/ConsoleSavedMenu.vue: both are
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
  backdropTestId: string;
  savedEntryTestId: string;
  recentEntryTestId?: string;
  emptySavedText: string;
  emptyRecentText?: string;
}>();

const emit = defineEmits<{
  apply: [entry: Entry];
  togglePin: [entry: Entry];
  delete: [entry: Entry];
  close: [];
}>();

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
  <PopoverPanel anchor="left" :width="320" :test-id="panelTestId" :backdrop-test-id="backdropTestId" @close="emit('close')">
    <div class="saved-list-menu-inner">
      <div class="p-menu-label">{{ title }}</div>
      <div v-if="saved.length === 0" class="empty-row p-sm dim">{{ emptySavedText }}</div>
      <div
        v-for="entry in saved"
        :key="entry.id"
        class="entry-row p-row"
        :data-testid="savedEntryTestId"
        @click="emit('apply', entry)"
      >
        <button
          type="button"
          class="pin-button"
          :class="{ pinned: isPinned(entry) }"
          v-tooltip="'Pin'"
          @click.stop="emit('togglePin', entry)"
        >
          <CodiconIcon :name="isPinned(entry) ? 'star-full' : 'star-empty'" :size="13" />
        </button>
        <slot name="entry" :entry="entry" />
        <span class="entry-actions">
          <slot name="entry-actions" :entry="entry" />
          <IconButton icon="trash" v-tooltip="'Delete'" @click.stop="emit('delete', entry)" />
        </span>
      </div>

      <template v-if="recent">
        <div class="p-sep" />
        <div class="p-menu-label">Recent</div>
        <div v-if="recent.length === 0" class="empty-row p-sm dim">{{ emptyRecentText }}</div>
        <div
          v-for="entry in recent"
          :key="entry.id"
          class="entry-row p-row"
          :data-testid="recentEntryTestId"
          @click="emit('apply', entry)"
        >
          <slot name="entry" :entry="entry" />
        </div>
      </template>

      <slot name="footer" />
    </div>
  </PopoverPanel>
</template>

<style scoped>
.saved-list-menu-inner {
  max-height: 400px;
  overflow-y: auto;
}

.empty-row {
  padding: var(--kira-s-2) var(--kira-s-3);
}

.entry-row {
  cursor: pointer;
}

/* Written by each caller inside the `entry` slot — :slotted() lets this shell still own the
   layout rule for it instead of every caller repeating it. */
:slotted(.entry-name) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-button {
  display: flex;
  background: transparent;
  border: none;
  color: var(--kira-fg-disabled);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.pin-button.pinned {
  color: var(--kira-warn);
}

.entry-actions {
  display: flex;
  gap: var(--kira-s-1);
  flex-shrink: 0;
}
</style>
