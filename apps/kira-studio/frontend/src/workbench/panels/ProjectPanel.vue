<script setup lang="ts">
import { nextTick, ref } from 'vue';
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import SearchBox from '../../project/SearchBox.vue';
import { treeState } from '../../project/state/tree';
import { connectionsState, openCreateDialog } from '../../state/connections';
import { schemaDialogState } from '../../state/schemas';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';

// Hidden by default (D-new): only the toggle button or typing a character reveals it, per the
// panel header staying a plain title bar until search is actually wanted.
const showSearch = ref(false);

function revealSearch(): void {
  if (showSearch.value) return;
  showSearch.value = true;
}

function toggleSearch(): void {
  showSearch.value = !showSearch.value;
  if (!showSearch.value) treeState.search = '';
}

// VS Code's own file-explorer "type to search" pattern: a tree row holds real DOM focus once
// selected (TreeRow.vue's roving tabindex), so a printable keystroke lands here via bubbling —
// this redirects it into the panel's own search box (SearchBox.vue's TextField, whose
// data-testid attr falls straight through to the real <input> since TextField sets
// inheritAttrs:false) rather than making the user click into Search first.
function onPanelKeydown(e: KeyboardEvent): void {
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
  treeState.search += e.key;
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
    <div class="p-panel-head">
      <span>Connections</span>
      <IconButton
        icon="search"
        class="p-push"
        :active="showSearch"
        aria-label="Search connections"
        v-tooltip="showSearch ? 'Hide search' : 'Search'"
        data-testid="toggle-search"
        @click="toggleSearch"
      />
      <IconButton
        icon="add"
        aria-label="Add connection"
        v-tooltip="'New connection'"
        data-testid="add-connection"
        @click="openCreateDialog"
      />
    </div>
    <template v-if="connectionsState.records.length > 0">
      <SearchBox v-if="showSearch" />
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <div v-else class="side-empty">
      <span class="dim"><CodiconIcon name="database" :size="24" /></span>
      <span class="p-xs dim side-empty-text">Everything you connect to<br />shows up here.</span>
    </div>
    <FiltersDialog />
    <SchemaDialog v-if="schemaDialogState.open" />
  </div>
</template>

<style scoped>
/* This panel's own header only — matches WorkbenchShell.vue's .tab-strip-slot (34px) exactly,
   rather than raising the shared .p-panel-head primitive every other panel still uses at 26px. */
.p-panel-head {
  height: 34px;
}

.side-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kira-s-4);
  padding: var(--kira-s-6);
  text-align: center;
}

.side-empty-text {
  line-height: 1.5;
}
</style>
