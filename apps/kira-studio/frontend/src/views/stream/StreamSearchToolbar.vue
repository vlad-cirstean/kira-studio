<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useEventListener } from '@vueuse/core';
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { usePageSearchFilterStore } from '../shared/page/searchFilter';
import { getPage, pageVersion } from './page';
import { useStreamSearchStore } from './search';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ goToMatch: [row: number]; close: [] }>();

const pageSearchFilterStore = usePageSearchFilterStore();
const streamSearchStore = useStreamSearchStore();

// README's own "search walks the loaded rows only and never issues a query" wording, borrowed
// verbatim from views/shared/page/SearchToolbar.vue's precedent — applies here too (item 5).
// P31 D22/F24: pageVersion.n is the explicit dependency — getPage reads a plain, non-reactive Map.
const loadedRowCount = computed(() => {
  void pageVersion.n;
  return getPage(props.tabId)?.rowCount ?? 0;
});

// P31 D17: the same filter-mode toggle views/shared/page/SearchToolbar.vue has (P24 D1/D9).
const filtering = computed(() => pageSearchFilterStore.isSearchFiltering(props.tabId));
const filteredRowCount = computed(
  () => streamSearchStore.matchedRows(props.tabId)?.length ?? null,
);
function toggleFilter(): void {
  pageSearchFilterStore.setSearchFiltering(props.tabId, !filtering.value);
}

const query = ref('');
const entry = computed(() => streamSearchStore.searchState[props.tabId]);

// See views/shared/page/SearchToolbar.vue's identical ref/onMounted pair for why onMounted is the
// right place to autofocus (this component is mounted fresh each time the toolbar opens). $el is
// already the <input> itself — ui/input's root IS the <input> element, unlike the old TextField's
// wrapping <span>.
const searchInput = ref<{ $el: HTMLInputElement } | null>(null);

watch(query, (q) => {
  streamSearchStore.runSearch(props.tabId, q);
  const e = streamSearchStore.searchState[props.tabId];
  if (e && e.matches.length > 0) emit('goToMatch', e.matches[0]);
});

// P31 D22/D23/F23: a Fetch more/poll/page change calls setPage and bumps pageVersion.n —
// re-scan against the new page (runSearch already resets index to the first match, or -1,
// per D23) without auto-scrolling; a background poll must not move the viewport under the user.
watch(
  () => pageVersion.n,
  () => {
    if (query.value !== '') streamSearchStore.runSearch(props.tabId, query.value);
  },
);

function next(): void {
  const row = streamSearchStore.goToNextMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}
function prev(): void {
  const row = streamSearchStore.goToPrevMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}

function close(): void {
  streamSearchStore.clearSearchState(props.tabId);
  // P24 D7/P31 D18: a closed toolbar must never leave rows hidden with no visible cause.
  pageSearchFilterStore.setSearchFiltering(props.tabId, false);
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

// P105 §5.1: the toolbar div is not interactive -- binds via VueUse instead of a raw @keydown.
const rootEl = useTemplateRef<HTMLElement>('rootEl');
useEventListener(rootEl, 'keydown', onKeydown);

onMounted(() => {
  void nextTick(() => searchInput.value?.$el.focus());
});

onUnmounted(() => {
  streamSearchStore.clearSearchState(props.tabId);
  // P31 D18: Cmd+F toggling the toolbar off unmounts this component without ever calling close()
  // above — the toggle must reset here too (mirrors views/shared/page/SearchToolbar.vue's own note).
  pageSearchFilterStore.setSearchFiltering(props.tabId, false);
});
</script>

<template>
  <!-- Docks below the toolbar it searches, same placement law as views/shared/page/SearchToolbar.vue. -->
  <div ref="rootEl" class="stream-search-toolbar p-toolbar" data-testid="stream-search-toolbar">
    <span class="icon-box muted"><CodiconIcon name="search" :size="13" /></span>
    <div class="search-input">
      <Input
        ref="searchInput"
        :model-value="query"
        placeholder="Find"
        class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
        data-testid="stream-search-input"
        @update:model-value="(v) => (query = String(v))"
      />
    </div>
    <span class="p-sm muted search-count" data-testid="stream-search-count">
      <template v-if="entry && entry.matches.length > 0">
        <b class="font-data">{{ entry.index + 1 }}</b> of <b class="font-data">{{ entry.matches.length }}</b>
      </template>
      <template v-else>0 of 0</template>
    </span>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="toolbar" size="kira-icon" aria-label="Previous match" data-testid="stream-search-prev" @click="prev">
          <CodiconIcon name="chevron-up" :size="13" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Previous match</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="toolbar" size="kira-icon" aria-label="Next match" data-testid="stream-search-next" @click="next">
          <CodiconIcon name="chevron-down" :size="13" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Next match</TooltipContent>
    </Tooltip>
    <div class="sep" />
    <!-- P31 D17: same filter *mode* as views/shared/page/SearchToolbar.vue (P24 D1/D9) — hides every
         non-matching row. -->
    <div class="group">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-field text-fg': filtering }"
            aria-label="Show only matching rows"
            data-testid="stream-search-filter-rows"
            @click="toggleFilter"
          >
            <CodiconIcon name="filter" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{
          filtering ? 'Showing only matching rows — click to show all' : 'Show only matching rows'
        }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="sep" />
    <span class="p-xs dim" data-testid="stream-search-scope">
      <template v-if="filtering && filteredRowCount !== null">
        showing {{ filteredRowCount.toLocaleString() }} of {{ loadedRowCount.toLocaleString() }} loaded rows
      </template>
      <template v-else>in the {{ loadedRowCount.toLocaleString() }} loaded rows</template>
    </span>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira-icon"
          class="p-push"
          aria-label="Close"
          data-testid="stream-search-close"
          @click="close"
        >
          <CodiconIcon name="close" :size="13" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close</TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.stream-search-toolbar {
  @apply bg-elevated;
}

.search-input {
  @apply w-52 shrink-0;
}

.search-count {
  @apply whitespace-nowrap;
}
</style>
