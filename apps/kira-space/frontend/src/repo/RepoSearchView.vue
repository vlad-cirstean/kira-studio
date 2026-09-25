<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Input } from '@theme/components/ui/input';
import { useEventListener } from '@vueuse/core';
import SearchOptionToggles from '@workbench/components/SearchOptionToggles.vue';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/util/virtualRows';
import { computed, ref, useTemplateRef } from 'vue';
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

const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => rows.value.length,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
});

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

// P105 §5.1: the toolbar div itself is not interactive -- binds via VueUse instead of a raw
// template @keydown on it.
const toolbarEl = useTemplateRef<HTMLElement>('toolbarEl');
useEventListener(toolbarEl, 'keydown', onQueryKeydown);

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
  <div class="h-full flex flex-col min-h-0">
    <div ref="toolbarEl" class="flex items-center gap-1 py-1 px-2">
      <div class="flex-1 min-w-0">
        <Input
          :model-value="query"
          placeholder="Search"
          class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2"
          data-testid="repo-search-query"
          :aria-invalid="!!error"
          @update:model-value="(v) => (query = String(v))"
        />
      </div>
      <!-- Case/Word/Regex: three independent toggles, not a single-value picker — the same three
           codicons SearchToolbar.vue's own find widget uses, so the two surfaces read as one
           vocabulary (D13). -->
      <div class="flex">
        <SearchOptionToggles
          :match-case="options.caseSensitive"
          :whole-word="options.wholeWord"
          :regex="options.regex"
          testid-prefix="repo-search-"
          match-case-test-id="repo-search-case"
          @update:match-case="onToggleOption('caseSensitive')"
          @update:whole-word="onToggleOption('wholeWord')"
          @update:regex="onToggleOption('regex')"
        />
      </div>
      <TooltipIconButton
        v-if="running"
        icon="debug-stop"
        label="Stop"
        data-testid="repo-search-stop"
        @click="repoSearchStore.cancelRepoSearch(repoId)"
      />
      <TooltipIconButton
        v-else
        icon="search"
        label="Search"
        data-testid="repo-search-run"
        @click="runSearch"
      />
    </div>
    <!-- Note-tinted background, error-tinted text -- the span carries text-error directly rather
         than on AlertDescription itself: the note variant's own
         `*:data-[slot=alert-description]:text-note-text` selector out-specifies a bare class on
         that same [data-slot] element. -->
    <Alert v-if="error" variant="note" data-testid="repo-search-error">
      <AlertDescription><span class="text-error">{{ error }}</span></AlertDescription>
    </Alert>
    <Alert
      v-else-if="statusLine"
      variant="note"
      class="mt-0 mx-2 mb-1"
      data-testid="repo-search-status"
    >
      <AlertDescription>{{ statusLine }}</AlertDescription>
    </Alert>
    <div
      ref="scrollEl"
      class="flex-1 min-h-0 overflow-auto"
      data-testid="virtual-list"
      role="listbox"
      aria-label="Search results"
      @scroll="onScroll"
    >
      <div :style="{ height: `${totalSize}px`, position: 'relative' }">
        <template v-for="item in virtualItems" :key="String(item.key)">
          <RepoSearchRow
            :class="VIRTUAL_ROW_CLASS"
            :style="{ transform: `translateY(${item.start}px)`, height: `${item.size}px` }"
            :row="rows[item.index]"
            :selected="selected === rows[item.index].key"
            @select="onSelect"
            @toggle-collapse="onToggleCollapse"
            @open="onOpen"
          />
        </template>
      </div>
    </div>
  </div>
  <!-- P110 I2-15: `.virtual-row` moved to VIRTUAL_ROW_CLASS (packages/workbench/src/util/
       virtualRows.ts) -- see kira-studio's ProjectTree.vue's identical note. -->
</template>

