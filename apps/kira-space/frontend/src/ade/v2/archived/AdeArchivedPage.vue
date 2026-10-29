<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';
import SearchField from '@theme/components/SearchField.vue';
import { Badge } from '@theme/components/ui/badge';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { paneFrame } from '@theme/lib/frames';
import { rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { formatDateTime } from '@workbench/behaviour/format';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import { matchesQuery } from '@workbench/behaviour/match';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed, ref } from 'vue';
import AdeArchivedPanel from '../panel/AdeArchivedPanel.vue';
import AdePanelPane from '../panel/AdePanelPane.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useAdeArchiveUiStore } from '../state/adeArchiveUi';
import type { HistoryEntry } from '../wire';

// Archived tasks, newest first, beside the full read-only panel of the selected one.
const archive = useAdeArchiveUiStore();
const { model, repoLabel } = usePlanModel();

const entries = computed(() => model.value?.board.history ?? []);
const repos = (e: HistoryEntry): string => e.codeRepoIds.map(repoLabel).join(' · ');
const shown = computed(() => {
  const q = archive.filter.trim();
  if (!q) return entries.value;
  return entries.value.filter((e) => matchesQuery(e.title, q) || matchesQuery(repos(e), q));
});

const listEl = ref<HTMLElement | null>(null);
const activeKey = ref<string | null>(null);
const nav = useListNavigation<HistoryEntry>({
  container: listEl,
  items: () => shown.value,
  key: (e) => e.taskId,
  activeKey,
  onSelect: (e) => archive.select(e.taskId),
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 gap-0.5" data-testid="ade-archived">
    <div :class="cn(paneFrame, 'flex flex-1 flex-col')">
      <PanelHeader>{{ t('space.ade.panel.archived.label') }}</PanelHeader>
      <template v-if="entries.length">
        <SearchField
          v-model="archive.filter"
          :placeholder="t('space.ade.archived.filter.placeholder')"
          :aria-label="t('space.ade.archived.filter.placeholder')"
          data-testid="ade-archived-filter"
        />
        <EmptyState
          v-if="shown.length === 0"
          :icon="ICON.search"
          :title="t('common.state.noMatches.empty')"
          data-testid="ade-archived-filter-empty"
        />
        <div
          v-else
          ref="listEl"
          role="listbox"
          class="flex min-h-0 flex-1 flex-col overflow-auto"
          :aria-label="t('space.ade.archived.list.aria')"
        >
          <div
            v-for="e in shown"
            :key="e.taskId"
            :class="
              cn(
                rowVariants({ layout: 'double', selected: e.taskId === archive.selectedTaskId }),
                'gap-2 border-b border-border pl-3',
              )
            "
            role="option"
            :aria-selected="e.taskId === archive.selectedTaskId"
            v-bind="nav.rowProps(e.taskId)"
            :tabindex="nav.tabindexFor(e.taskId)"
            data-testid="ade-archived-row"
            :data-task-id="e.taskId"
            @click="archive.select(e.taskId)"
            @keydown.space.self.prevent="archive.select(e.taskId)"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-kira-md">{{ e.title }}</span>
              <span class="truncate text-kira-sm text-subtle">{{
                [repos(e), formatDateTime(e.archivedAt)].filter(Boolean).join(' · ')
              }}</span>
            </div>
            <Badge v-if="e.mergedAt" variant="chip" class="shrink-0">{{
              t('common.merged.status')
            }}</Badge>
          </div>
        </div>
      </template>
      <EmptyState
        v-else
        fill
        :icon="ICON.history"
        :title="t('space.ade.archived.list.empty')"
        data-testid="ade-archived-empty"
      />
    </div>
    <AdePanelPane>
      <AdeArchivedPanel v-if="archive.selectedTaskId" :task-id="archive.selectedTaskId" />
      <EmptyState
        v-else
        fill
        :title="t('space.ade.archived.select.emptyHint')"
        data-testid="ade-panel-empty"
      />
    </AdePanelPane>
  </div>
</template>
