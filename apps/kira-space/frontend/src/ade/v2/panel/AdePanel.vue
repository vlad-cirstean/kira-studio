<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';
import { paneFrame } from '@theme/components/frames';
import { ResizeHandle } from '@theme/components/ui/resizable';
import { useLiveSize } from '@theme/components/ui/resizable/useLiveSize';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useElementSize, useParentElement } from '@vueuse/core';
import { computed } from 'vue';
import { useAdeLayoutStore } from '../../../state/adeLayout';
import { usePlanModel } from '../plan/usePlanModel';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeArchivedPanel from './AdeArchivedPanel.vue';
import AdeBranchPanel from './AdeBranchPanel.vue';
import AdeTaskPanel from './AdeTaskPanel.vue';

// Right-hand panel of the Plan: the selected task, or one of its branches. Width is
// `panel.ade.width` in the layout store, 0 = half the row.
const MIN_WIDTH = 340;
const MIN_PLAN = 320;

const ui = useAdeBoardUiStore();
const layout = useAdeLayoutStore();
const { model } = usePlanModel();

const parent = useParentElement();
const { width: rowWidth } = useElementSize(parent);

const maxWidth = computed(() => Math.max(MIN_WIDTH, rowWidth.value - MIN_PLAN));
const pane = useLiveSize(
  () => {
    const stored = layout.width;
    const base = stored > 0 ? stored : Math.round(rowWidth.value / 2);
    return Math.max(MIN_WIDTH, Math.min(maxWidth.value, base));
  },
  (w) => layout.setWidth(Math.round(w)),
);
const width = pane.size;

const card = computed(() =>
  ui.selectedTaskId ? (model.value?.cardFor(ui.selectedTaskId) ?? null) : null,
);
/** The selected task when it is archived: it left the board and survives in History. */
const archived = computed(() =>
  card.value
    ? null
    : (model.value?.board.history.find((h) => h.taskId === ui.selectedTaskId) ?? null),
);
const row = computed(() => card.value?.rows.find((r) => r.id === ui.selectedBranchId) ?? null);
</script>

<template>
  <ResizeHandle
    :label="t('space.ade.panel.resize.label')"
    data-testid="ade-panel-resize-handle"
    direction="reverse"
    :min="MIN_WIDTH"
    :max="maxWidth"
    v-bind="pane.bind"
  />
  <aside
    :class="cn(paneFrame, 'flex shrink-0 flex-col')"
    :style="{ width: `${width}px` }"
    data-testid="ade-panel"
  >
    <template v-if="model && card">
      <AdeBranchPanel v-if="row" :card="card" :row="row" :model="model" />
      <AdeTaskPanel v-else :card="card" :model="model" />
    </template>
    <AdeArchivedPanel v-else-if="archived" :entry="archived" />
    <EmptyState
      v-else
      fill
      :title="t('space.ade.panel.empty.emptyHint')"
      data-testid="ade-panel-empty"
    />
  </aside>
</template>
