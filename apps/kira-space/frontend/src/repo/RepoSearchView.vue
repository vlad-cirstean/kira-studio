<script setup lang="ts">
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import VirtualList from '@theme/primitives/VirtualList.vue';
import { computed, ref } from 'vue';
import { openRepoFileTab } from '../state/repoTabs';
import { useSettingsStore } from '../state/settings';
import RepoSearchRow from './RepoSearchRow.vue';
import { type RepoSearchRowVm, useRepoSearchStore } from './state/search';

// C7 §7.3: the query field, the three Monaco-find-widget-vocabulary toggles (D13: the same three
// codicons the in-file find widget and every other search surface in this app already use), the
// Search/Stop button, and the streamed results list.
const props = defineProps<{ repoId: string }>();
const repoSearchStore = useRepoSearchStore();
const settingsStore = useSettingsStore();

const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));
const selected = ref<string | null>(null);

const query = computed({
  get: () => repoSearchStore.repoSearchQuery(props.repoId),
  set: (v: string) => repoSearchStore.setRepoSearchQuery(props.repoId, v),
});
const options = computed(() => repoSearchStore.repoSearchOptions(props.repoId));
const running = computed(() => repoSearchStore.repoSearchRunning(props.repoId));
const stats = computed(() => repoSearchStore.repoSearchStats(props.repoId));
const error = computed(() => repoSearchStore.repoSearchError(props.repoId));
const rows = computed(() => repoSearchStore.repoSearchRows(props.repoId));

// §7.3: "Searching…" while running, "N results in M files" when done, "(stopped at 10,000)"
// appended when the whole run hit the cap, "K files skipped" appended when non-zero — the skip
// count is surfaced, never silent (D4).
const statusLine = computed(() => {
  if (running.value) return 'Searching…';
  const s = stats.value;
  if (!s) return '';
  const resultWord = s.matches === 1 ? 'result' : 'results';
  const fileWord = s.filesMatched === 1 ? 'file' : 'files';
  let line = `${s.matches.toLocaleString()} ${resultWord} in ${s.filesMatched.toLocaleString()} ${fileWord}`;
  if (s.truncated) line += ' (stopped at 10,000)';
  if (s.filesSkipped > 0) {
    const skipWord = s.filesSkipped === 1 ? 'file' : 'files';
    line += ` — ${s.filesSkipped.toLocaleString()} ${skipWord} skipped`;
  }
  return line;
});

function runSearch(): void {
  void repoSearchStore.startRepoSearch(props.repoId);
}

function onToggleOption(key: 'regex' | 'caseSensitive' | 'wholeWord'): void {
  repoSearchStore.toggleRepoSearchOption(props.repoId, key);
}

// D10: a search runs on Enter or the Search button only, never on every keystroke.
function onQueryKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    runSearch();
  } else if (e.key === 'Escape') {
    repoSearchStore.setRepoSearchQuery(props.repoId, '');
  }
}

function onSelect(row: RepoSearchRowVm): void {
  selected.value = row.key;
}

function onToggleCollapse(row: RepoSearchRowVm): void {
  repoSearchStore.toggleRepoSearchCollapse(props.repoId, row.path);
}

// §7.4/D12: a single click opens a preview tab, double-click/Enter a permanent one — the tree's
// own onSelect/onOpen split (RepoSearchRow.vue already resolved which this is). The reveal moves
// the cursor whether the tab is freshly opened or already mounted and active (D12's own fix).
function onOpen(row: RepoSearchRowVm, preview: boolean): void {
  if (row.kind !== 'match' || row.line === undefined || row.column === undefined) return;
  void openRepoFileTab(props.repoId, row.path, {
    preview,
    reveal: { line: row.line, column: row.column, endColumn: row.endColumn },
  });
}
</script>

<template>
  <div class="repo-search-view">
    <div class="repo-search-toolbar" @keydown="onQueryKeydown">
      <div class="repo-search-input">
        <TextField
          v-model="query"
          placeholder="Search"
          data-testid="repo-search-query"
          :invalid="!!error"
        />
      </div>
      <!-- Case/Word/Regex: three independent toggles, not a single-value picker — the same three
           codicons SearchToolbar.vue's own find widget uses, so the two surfaces read as one
           vocabulary (D13). -->
      <div class="group">
        <IconButton
          icon="case-sensitive"
          :active="options.caseSensitive"
          v-tooltip="'Match case'"
          data-testid="repo-search-case"
          @click="onToggleOption('caseSensitive')"
        />
        <IconButton
          icon="whole-word"
          :active="options.wholeWord"
          v-tooltip="'Whole word'"
          data-testid="repo-search-whole-word"
          @click="onToggleOption('wholeWord')"
        />
        <IconButton
          icon="regex"
          :active="options.regex"
          v-tooltip="'Regular expression'"
          data-testid="repo-search-regex"
          @click="onToggleOption('regex')"
        />
      </div>
      <IconButton
        v-if="running"
        icon="debug-stop"
        v-tooltip="'Stop'"
        data-testid="repo-search-stop"
        @click="repoSearchStore.cancelRepoSearch(repoId)"
      />
      <IconButton
        v-else
        icon="search"
        v-tooltip="'Search'"
        data-testid="repo-search-run"
        @click="runSearch"
      />
    </div>
    <div v-if="error" class="p-strip note error-note" data-testid="repo-search-error">
      {{ error }}
    </div>
    <div
      v-else-if="statusLine"
      class="p-strip note repo-search-status"
      data-testid="repo-search-status"
    >
      {{ statusLine }}
    </div>
    <VirtualList class="repo-search-list" :items="rows" :row-height="rowHeight">
      <template #default="{ item }">
        <RepoSearchRow
          :row="item"
          :selected="selected === item.key"
          @select="onSelect"
          @toggle-collapse="onToggleCollapse"
          @open="onOpen"
        />
      </template>
    </VirtualList>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.repo-search-view {
  @apply h-full flex flex-col min-h-0;
}

.repo-search-toolbar {
  @apply flex items-center gap-[var(--kira-s-2)] py-[var(--kira-s-2)] px-[var(--kira-s-4)];
}

.repo-search-input {
  @apply flex-1 min-w-0;
}

.repo-search-input :deep(.p-input) {
  @apply w-full;
}

.group {
  @apply flex;
}

.repo-search-status {
  @apply mt-0 mx-[var(--kira-s-4)] mb-[var(--kira-s-2)];
}

.error-note {
  @apply text-error;
}

.repo-search-list {
  @apply flex-1 min-h-0;
}
</style>
