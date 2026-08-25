<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { isSearchFiltering, setSearchFiltering } from '../shared/page/searchFilter';
import { getPage, pageVersion } from './page';
import {
  clearSearchState,
  goToNextMatch,
  goToPrevMatch,
  matchedRows,
  runSearch,
  searchState,
} from './search';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ goToMatch: [row: number]; close: [] }>();

// README's own "search walks the loaded rows only and never issues a query" wording, borrowed
// verbatim from grid/SearchToolbar.vue's precedent — applies here too (item 5).
// P31 D22/F24: pageVersion.n is the explicit dependency — getPage reads a plain, non-reactive Map.
const loadedRowCount = computed(() => {
  void pageVersion.n;
  return getPage(props.tabId)?.rowCount ?? 0;
});

// P31 D17: the same filter-mode toggle grid/SearchToolbar.vue has (P24 D1/D9).
const filtering = computed(() => isSearchFiltering(props.tabId));
const filteredRowCount = computed(() => matchedRows(props.tabId)?.length ?? null);
function toggleFilter(): void {
  setSearchFiltering(props.tabId, !filtering.value);
}

const query = ref('');
const entry = computed(() => searchState[props.tabId]);

// See views/grid/SearchToolbar.vue's identical ref/onMounted pair for why $el is the focus
// target (TextField wraps its <input> in its own root <span>, P4) and why onMounted is the
// right place to autofocus (this component is mounted fresh each time the toolbar opens).
const searchInput = ref<{ $el: HTMLElement } | null>(null);

watch(query, (q) => {
  runSearch(props.tabId, q);
  const e = searchState[props.tabId];
  if (e && e.matches.length > 0) emit('goToMatch', e.matches[0]);
});

// P31 D22/D23/F23: a Fetch more/poll/page change calls setPage and bumps pageVersion.n —
// re-scan against the new page (runSearch already resets index to the first match, or -1,
// per D23) without auto-scrolling; a background poll must not move the viewport under the user.
watch(
  () => pageVersion.n,
  () => {
    if (query.value !== '') runSearch(props.tabId, query.value);
  },
);

function next(): void {
  const row = goToNextMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}
function prev(): void {
  const row = goToPrevMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}

function close(): void {
  clearSearchState(props.tabId);
  // P24 D7/P31 D18: a closed toolbar must never leave rows hidden with no visible cause.
  setSearchFiltering(props.tabId, false);
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) prev();
    else next();
  }
}

onMounted(() => {
  void nextTick(() => searchInput.value?.$el.querySelector('input')?.focus());
});

onUnmounted(() => {
  clearSearchState(props.tabId);
  // P31 D18: Cmd+F toggling the toolbar off unmounts this component without ever calling close()
  // above — the toggle must reset here too (mirrors grid/SearchToolbar.vue's own note).
  setSearchFiltering(props.tabId, false);
});
</script>

<template>
  <!-- Docks below the toolbar it searches, same placement law as grid/SearchToolbar.vue. -->
  <div class="stream-search-toolbar p-toolbar" data-testid="stream-search-toolbar" @keydown="onKeydown">
    <span class="icon-box muted"><CodiconIcon name="search" :size="13" /></span>
    <div class="search-input">
      <TextField
        ref="searchInput"
        v-model="query"
        placeholder="Find"
        data-testid="stream-search-input"
      />
    </div>
    <span class="p-sm muted search-count" data-testid="stream-search-count">
      <template v-if="entry && entry.matches.length > 0">
        <b class="mono">{{ entry.index + 1 }}</b> of <b class="mono">{{ entry.matches.length }}</b>
      </template>
      <template v-else>0 of 0</template>
    </span>
    <IconButton icon="chevron-up" v-tooltip="'Previous match'" data-testid="stream-search-prev" @click="prev" />
    <IconButton icon="chevron-down" v-tooltip="'Next match'" data-testid="stream-search-next" @click="next" />
    <div class="sep" />
    <!-- P31 D17: same filter *mode* as grid/SearchToolbar.vue (P24 D1/D9) — hides every
         non-matching row. -->
    <div class="group">
      <IconButton
        icon="filter"
        :active="filtering"
        v-tooltip="
          filtering ? 'Showing only matching rows — click to show all' : 'Show only matching rows'
        "
        data-testid="stream-search-filter-rows"
        @click="toggleFilter"
      />
    </div>
    <div class="sep" />
    <span class="p-xs dim" data-testid="stream-search-scope">
      <template v-if="filtering && filteredRowCount !== null">
        showing {{ filteredRowCount.toLocaleString() }} of {{ loadedRowCount.toLocaleString() }} loaded rows
      </template>
      <template v-else>in the {{ loadedRowCount.toLocaleString() }} loaded rows</template>
    </span>
    <IconButton icon="close" class="p-push" v-tooltip="'Close'" data-testid="stream-search-close" @click="close" />
  </div>
</template>

<style scoped>
.stream-search-toolbar {
  background: var(--kira-bg-elevated);
}

.search-input {
  width: 200px;
  flex-shrink: 0;
}

.search-input :deep(.p-input) {
  width: 100%;
}

.search-count {
  white-space: nowrap;
}
</style>
