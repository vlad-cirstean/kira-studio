<script setup lang="ts">
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SearchBox from '../../project/SearchBox.vue';
import { treeState } from '../../project/state/tree';
import { connectionsState, openCreateDialog } from '../../state/connections';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';

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
  const input = container.querySelector<HTMLInputElement>('[data-testid="tree-search"]');
  if (!input) return;
  e.preventDefault();
  treeState.search += e.key;
  input.focus();
}
</script>

<template>
  <div class="flex h-full flex-col" @keydown="onPanelKeydown">
    <div class="p-panel-head">
      <span>Connections</span>
      <IconButton
        icon="add"
        :size="14"
        class="p-push"
        aria-label="Add connection"
        v-tooltip="'New connection'"
        data-testid="add-connection"
        @click="openCreateDialog"
      />
    </div>
    <template v-if="connectionsState.records.length > 0">
      <SearchBox />
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
  </div>
</template>

<style scoped>
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
