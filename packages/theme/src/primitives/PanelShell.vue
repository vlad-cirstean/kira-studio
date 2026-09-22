<script setup lang="ts">
import IconButton from '@theme/primitives/IconButton.vue';
import PanelSearchBox from '@theme/primitives/PanelSearchBox.vue';
import { nextTick, ref } from 'vue';

// P1 D3: the mode-agnostic panel shell — header geometry, the search reveal/toggle and the
// type-ahead redirect, moved verbatim out of ProjectPanel.vue (F7). What is NOT generic (the
// title, the header actions, the body, and what "empty" looks like) comes from the mounting
// mode's own content through these four slots: #title, #actions, #body, #empty.
const props = withDefaults(
  defineProps<{
    search?: string;
    /** True hides the search box and #body in favour of #empty — the mode's own gate on
     *  whether it has anything to search or show (Studio: connectionsState.records.length). */
    empty?: boolean;
    /** C7 §7.1: false hides the magnifier toggle and the search box entirely — the repo panel's
     *  own Search mode has its own query field (RepoSearchView.vue) and this panel-level filter
     *  box would read as a second, confusing query field beside it. Default true: every existing
     *  caller is unaffected. */
    searchable?: boolean;
  }>(),
  { search: '', empty: false, searchable: true },
);

const emit = defineEmits<{
  'update:search': [value: string];
}>();

// Hidden by default: only the toggle button or typing a character reveals it, per the panel
// header staying a plain title bar until search is actually wanted.
const showSearch = ref(false);

function revealSearch(): void {
  if (showSearch.value) return;
  showSearch.value = true;
}

function toggleSearch(): void {
  showSearch.value = !showSearch.value;
  if (!showSearch.value) emit('update:search', '');
}

// VS Code's own file-explorer "type to search" pattern: a tree row holds real DOM focus once
// selected, so a printable keystroke lands here via bubbling — this redirects it into the
// panel's own search box rather than making the user click into Search first.
function onPanelKeydown(e: KeyboardEvent): void {
  if (!props.searchable) return; // C7 §7.1: no filter box to redirect a keystroke into.
  if (e.defaultPrevented || e.isComposing) return;
  // Cmd/Ctrl/Alt-held combos are shortcuts (or menu accelerators, which arrive over IPC and
  // never reach here anyway) — never type-ahead candidates. Shift is left out on purpose so
  // Shift+letter (an uppercase character) still redirects.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // A single printable character only — this also excludes every named key (Enter, Escape,
  // Tab, the arrow keys, …) since those all report a multi-character e.key. Space is excluded
  // too: it's reserved for the tree's own row activation, not the search box.
  if (e.key.length !== 1 || e.key === ' ') return;
  const target = e.target as HTMLElement | null;
  // Already typing somewhere (the search box itself, a dialog field, …) — let it behave normally.
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const container = e.currentTarget as HTMLElement;
  e.preventDefault();
  emit('update:search', props.search + e.key);
  const wasHidden = !showSearch.value;
  revealSearch();
  // The search box only mounts once showSearch flips true, so a reveal-by-typing needs a tick
  // before the input actually exists in the DOM to focus.
  if (wasHidden) {
    void nextTick(() => {
      container.querySelector<HTMLInputElement>('[data-testid="tree-search"]')?.focus();
    });
  } else {
    container.querySelector<HTMLInputElement>('[data-testid="tree-search"]')?.focus();
  }
}
</script>

<template>
  <div class="flex h-full flex-col" @keydown="onPanelKeydown">
    <div class="p-panel-head h-[34px]">
      <slot name="title" />
      <IconButton
        v-if="searchable"
        icon="search"
        class="p-push"
        :active="showSearch"
        aria-label="Search"
        v-tooltip="showSearch ? 'Hide search' : 'Search'"
        data-testid="toggle-search"
        @click="toggleSearch"
      />
      <slot name="actions" />
    </div>
    <template v-if="!empty">
      <PanelSearchBox
        v-if="searchable && showSearch"
        :model-value="search"
        @update:model-value="emit('update:search', $event)"
      />
      <div class="min-h-0 flex-1">
        <slot name="body" />
      </div>
    </template>
    <div
      v-else
      class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-[var(--kira-s-4)] p-[var(--kira-s-6)] text-center"
    >
      <slot name="empty" />
    </div>
  </div>
</template>
