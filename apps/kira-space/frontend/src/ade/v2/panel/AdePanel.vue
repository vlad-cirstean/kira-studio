<script setup lang="ts">
import { useElementSize, useParentElement } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useSettingsStore } from '../../../state/settings';
import { usePlanModel } from '../plan/usePlanModel';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdePanelResizeHandle from './AdePanelResizeHandle.vue';
import AdeTaskPanel from './AdeTaskPanel.vue';

// Right-hand panel of the Plan: the selected task, or one of its branches. Width is
// `Settings.ade.panelWidth`, 0 = half the row.
const MIN_WIDTH = 340;
const MIN_PLAN = 320;

const ui = useAdeBoardUiStore();
const settingsStore = useSettingsStore();
const { model } = usePlanModel();

const parent = useParentElement();
const { width: rowWidth } = useElementSize(parent);
const live = ref<number | null>(null);

const maxWidth = computed(() => Math.max(MIN_WIDTH, rowWidth.value - MIN_PLAN));
const width = computed(() => {
  const stored = settingsStore.ade.panelWidth;
  const base = stored > 0 ? stored : Math.round(rowWidth.value / 2);
  return Math.max(MIN_WIDTH, Math.min(maxWidth.value, live.value ?? base));
});

async function commit(w: number): Promise<void> {
  live.value = null;
  await settingsStore.patchSettings({ ade: { panelWidth: Math.round(w) } });
}

const card = computed(() => (ui.selectedTaskId ? (model.value?.cardFor(ui.selectedTaskId) ?? null) : null));
</script>

<template>
  <AdePanelResizeHandle :value="width" :min="MIN_WIDTH" :max="maxWidth" @resize="(w) => (live = w)" @commit="commit" />
  <aside
    class="flex min-h-0 shrink-0 flex-col bg-chrome"
    :style="{ width: `${width}px` }"
    data-testid="ade-panel"
  >
    <template v-if="model && card">
      <AdeTaskPanel :card="card" :model="model" />
    </template>
    <p v-else class="p-5 text-kira-md text-muted-foreground" data-testid="ade-panel-empty">
      Select a task to see its details.
    </p>
  </aside>
</template>
