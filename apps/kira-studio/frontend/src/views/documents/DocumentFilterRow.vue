<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import AutocompleteField from '@workbench/components/AutocompleteField.vue';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import type { DocumentTabRecord } from '../../state/tabDomain';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import {
  mongoFilterCandidates,
  mongoSortCandidates,
  useMongoFieldSampleStore,
} from '../shared/mongoFieldSample';
import { fieldNamesOnPage, pageVersion } from './page';
import { parseSortText, sortSpecToText } from './sortDocument';
import { useDocumentViewStore } from './state';

// The filter and sort row of a document tab: one permanent filter box, a sort box, filter history
// and Clear. Mirrors FilterToolbar's guards and history recording for Mongo's filter/sort documents.
const props = defineProps<{ tab: DocumentTabRecord }>();

// Mongo syntax samples, not wording.
const FILTER_EXAMPLE = "{ name: 'a' }";
const SORT_EXAMPLE = '{ createdAt: -1, name: 1 }';

const documentViewStore = useDocumentViewStore();
const mongoFieldSampleStore = useMongoFieldSampleStore();

const searchText = ref('');
const sortText = ref('');
// patchDocumentTabState mutates tab.state in place: these watchers keep the boxes in sync with
// writes that did not come from typing (Clear, history apply).
watch(
  () => props.tab.state.search,
  (search) => {
    searchText.value = search;
  },
  { immediate: true },
);
watch(
  () => props.tab.state.sort,
  (sort) => {
    sortText.value = sortSpecToText(sort);
  },
  { immediate: true },
);

const filterCandidates = computed(() => {
  void pageVersion.n;
  return mongoFilterCandidates(['_id', ...fieldNamesOnPage(props.tab.id)]);
});
const sortCandidates = computed(() => {
  void pageVersion.n;
  return mongoSortCandidates(['_id', ...fieldNamesOnPage(props.tab.id)]);
});

watch(
  () => [pageVersion.n, props.tab.connectionId, props.tab.path] as const,
  ([, connectionId, path]) => {
    if (!connectionId) return;
    mongoFieldSampleStore.registerMongoFieldSample(
      connectionId,
      path,
      fieldNamesOnPage(props.tab.id),
    );
  },
  { immediate: true },
);

function recordFilterHistory(search: string, sort: SortSpec | null): void {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return;
  fireAndForget(
    control.queriesHistoryRecord(connectionId, props.tab.path, search === '' ? null : search, sort),
    'documents.recordFilterHistory',
  );
}

function onSearchInput(): void {
  // Blur fires on every focus loss; re-applying an unchanged filter would reset paging and count.
  if (searchText.value.trim() === props.tab.state.search.trim()) return;
  documentViewStore.setSearch(props.tab.id, searchText.value);
  recordFilterHistory(searchText.value, props.tab.state.sort);
}
function onSearchEscape(): void {
  searchText.value = props.tab.state.search;
  (document.activeElement as HTMLElement | null)?.blur();
}

function onSortInput(): void {
  const sort = parseSortText(sortText.value);
  // Compare the text form: SortSpec is a structure, so identity never matches.
  if (sortSpecToText(sort) === sortSpecToText(props.tab.state.sort)) return;
  documentViewStore.setSort(props.tab.id, sort);
  recordFilterHistory(props.tab.state.search, sort);
}
function onSortEscape(): void {
  sortText.value = sortSpecToText(props.tab.state.sort);
  (document.activeElement as HTMLElement | null)?.blur();
}

function onClearFilter(): void {
  documentViewStore.setSearch(props.tab.id, '');
  documentViewStore.setSort(props.tab.id, null);
  recordFilterHistory('', null);
}

const filterHistoryOpen = ref(false);
const filterHistoryTriggerEl = ref<{ $el: HTMLElement } | null>(null);
function applyFromFilterHistory(where: string | null, orderBy: SortSpec | null): void {
  documentViewStore.setSearch(props.tab.id, where ?? '');
  documentViewStore.setSort(props.tab.id, orderBy);
}
</script>

<template>
  <ViewToolbar border="none">
    <div class="relative">
      <TooltipIconButton
        :icon="ICON.history"
        :label="t('studio.common.savedAndRecentFilters.label')"
        ref="filterHistoryTriggerEl"
        data-testid="document-filter-history-button"
        @click="filterHistoryOpen = !filterHistoryOpen"
      />
      <Popover :open="filterHistoryOpen" @update:open="(v) => (filterHistoryOpen = v)">
        <PopoverAnchor
          :reference="(filterHistoryTriggerEl?.$el as HTMLElement) ?? undefined"
          class="hidden"
        />
        <FilterHistoryMenu
          v-if="filterHistoryOpen"
          :connection-id="tab.connectionId"
          :path="tab.path"
          :current-filter="searchText === '' ? null : searchText"
          :current-sort="tab.state.sort"
          @apply="applyFromFilterHistory"
          @close="filterHistoryOpen = false"
        />
      </Popover>
    </div>
    <div class="flex-1 min-w-0">
      <Tooltip>
        <TooltipTrigger as-child>
          <AutocompleteField
            v-model="searchText"
            class="w-full"
            prefix="FILTER"
            :prefix-active="tab.state.search.trim() !== ''"
            :placeholder="FILTER_EXAMPLE"
            data-testid="document-search"
            :candidates="filterCandidates"
            language="mongo"
            @enter="onSearchInput"
            @escape="onSearchEscape"
            @blur="onSearchInput"
          />
        </TooltipTrigger>
        <TooltipContent>{{ t('studio.documents.filter.tooltip') }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="w-72 shrink-0">
      <Tooltip>
        <TooltipTrigger as-child>
          <AutocompleteField
            v-model="sortText"
            class="w-full"
            prefix="SORT"
            :prefix-active="!!tab.state.sort"
            :placeholder="SORT_EXAMPLE"
            data-testid="document-sort"
            :candidates="sortCandidates"
            language="mongo"
            @enter="onSortInput"
            @escape="onSortEscape"
            @blur="onSortInput"
          />
        </TooltipTrigger>
        <TooltipContent>{{ t('studio.documents.sort.tooltip') }}</TooltipContent>
      </Tooltip>
    </div>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira"
          data-testid="document-filter-clear"
          @click="onClearFilter"
          >{{
            t('common.action.clear.label')
          }}</Button
        >
      </TooltipTrigger>
      <TooltipContent>{{ t('studio.common.clearFilters.tooltip') }}</TooltipContent>
    </Tooltip>
  </ViewToolbar>
</template>
