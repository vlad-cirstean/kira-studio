<script setup lang="ts">
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { useFindBar } from '@workbench/behaviour/findBar';
import { useFocusOnMount } from '@workbench/behaviour/focus';
import { formatCount } from '@workbench/behaviour/format';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue';
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
const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tabId);
});
const loadedRowCount = computed(() => page.value?.rowCount ?? 0);

// P31 D17: the same filter-mode toggle views/shared/page/SearchToolbar.vue has (P24 D1/D9).
const filtering = computed(() => pageSearchFilterStore.isSearchFiltering(props.tabId));
const filteredRowCount = computed(() => streamSearchStore.matchedRows(props.tabId)?.length ?? null);
function toggleFilter(): void {
  pageSearchFilterStore.setSearchFiltering(props.tabId, !filtering.value);
}

const query = ref('');
const entry = computed(() => streamSearchStore.searchState[props.tabId]);

// The scan decodes every cell of the page synchronously, so useFindBar debounces it per keystroke.
// `closed` drops a debounced run that lands after the bar closed.
let closed = false;
function searchNow(q: string): void {
  if (closed) return;
  streamSearchStore.runSearch(props.tabId, q);
  const e = streamSearchStore.searchState[props.tabId];
  if (e && e.matches.length > 0) emit('goToMatch', e.matches[0]);
}

// P31 D22/D23/F23: a Fetch more/poll/page change calls setPage and bumps pageVersion.n —
// re-scan against the new page (runSearch already resets index to the first match, or -1,
// per D23) without auto-scrolling; a background poll must not move the viewport under the user.
watch(page, () => {
  if (query.value !== '') streamSearchStore.runSearch(props.tabId, query.value);
});

function next(): void {
  const row = streamSearchStore.goToNextMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}
function prev(): void {
  const row = streamSearchStore.goToPrevMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}

function close(): void {
  closed = true;
  streamSearchStore.clearSearchState(props.tabId);
  // P24 D7/P31 D18: a closed toolbar must never leave rows hidden with no visible cause.
  pageSearchFilterStore.setSearchFiltering(props.tabId, false);
  emit('close');
}

// P105 §5.1: the toolbar div is not interactive -- useFindBar binds the keys on it.
const rootEl = useTemplateRef<InstanceType<typeof ViewToolbar>>('rootEl');
useFindBar({ root: rootEl, query, onQuery: searchNow, next, prev, close });

onUnmounted(() => {
  closed = true;
  streamSearchStore.clearSearchState(props.tabId);
  // P31 D18: Cmd+F toggling the toolbar off unmounts this component without ever calling close()
  // above — the toggle must reset here too (mirrors views/shared/page/SearchToolbar.vue's own note).
  pageSearchFilterStore.setSearchFiltering(props.tabId, false);
});

// Mounted fresh each time the bar opens, so mount is the moment to hand it focus.
const fieldWrap = useTemplateRef<HTMLElement>('fieldWrap');
useFocusOnMount(computed(() => fieldWrap.value?.querySelector('input')));
</script>

<template>
  <!-- Docks below the toolbar it searches, same placement law as views/shared/page/SearchToolbar.vue. -->
  <ViewToolbar ref="rootEl" class="bg-elevated" data-testid="stream-search-toolbar">
    <div ref="fieldWrap" class="w-52 shrink-0">
      <SearchField
        v-model="query"
        @keydown.escape.stop="close"
        :placeholder="t('common.action.find.label')"
        data-testid="stream-search-input"
      />
    </div>
    <span
      class="text-kira-sm text-muted-foreground whitespace-nowrap"
      data-testid="stream-search-count"
    >
      <template v-if="entry && entry.matches.length > 0">
        <CatalogText k="common.matchPosition.status">
          <template #position><b class="font-data">{{ entry.index + 1 }}</b></template>
          <template #total><b class="font-data">{{ entry.matches.length }}</b></template>
        </CatalogText>
      </template>
      <template v-else>{{ t('common.state.noMatches.empty') }}</template>
    </span>
    <TooltipIconButton
      icon="chevron-up"
      :label="t('common.action.previousMatch.label')"
      data-testid="stream-search-prev"
      @click="prev"
    />
    <TooltipIconButton
      icon="chevron-down"
      :label="t('common.action.nextMatch.label')"
      data-testid="stream-search-next"
      @click="next"
    />
    <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />
    <!-- P31 D17: same filter *mode* as views/shared/page/SearchToolbar.vue (P24 D1/D9) — hides every
         non-matching row. -->
    <div class="flex items-center gap-1.5 min-w-0">
      <TooltipIconButton
        icon="filter"
        :label="t(filtering ? 'studio.search.filteringRows.tooltip' : 'studio.search.filterRows.tooltip')"
        :aria-label="t('studio.search.filterRows.tooltip')"
        :class="{ 'bg-field text-fg': filtering }"
        data-testid="stream-search-filter-rows"
        @click="toggleFilter"
      />
    </div>
    <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />
    <span class="text-kira-sm text-subtle" data-testid="stream-search-scope">
      <template v-if="filtering && filteredRowCount !== null">
        {{
          t('studio.search.scopeFilteredRows.status', { shown: formatCount(filteredRowCount), count: loadedRowCount })
        }}
      </template>
      <template v-else>{{
        t('studio.search.scopeRows.status', { count: loadedRowCount })
      }}</template>
    </span>
    <TooltipIconButton
      icon="close"
      :label="t('common.action.close.label')"
      class="ml-auto"
      data-testid="stream-search-close"
      @click="close"
    />
  </ViewToolbar>
</template>
