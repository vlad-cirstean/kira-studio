<script setup lang="ts">
import { computed } from 'vue';
import { cacheStatsState } from '../state/cacheStats';
import { settingsOpen } from '../state/settings';
import Codicon from '../theme/Codicon.vue';
import SettingsDialog from './SettingsDialog.vue';
import { engineState } from './state/engine';
import {
  layoutState,
  toggleCellEditorPanel,
  toggleOperationsPanel,
  toggleProjectPanel,
} from './state/layout';

const cacheTitle = computed(() => {
  const stats = cacheStatsState.stats;
  if (!stats) return undefined;
  const total = stats.l2Hits + stats.l2Misses;
  const hitRate = total === 0 ? 0 : Math.round((stats.l2Hits / total) * 100);
  return `L2 ${stats.l2Entries} pages, ${hitRate}% hit rate, ${stats.l3Entries} cached counts`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsState.stats;
  if (!stats) return null;
  return `${(stats.l2Bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>

<template>
  <div class="p-statusbar" :style="{ color: 'var(--kira-fg-muted)' }">
    <div class="side">
      <button
        type="button"
        class="p-status"
        :class="{ 'is-on': layoutState.panel.project.visible }"
        data-testid="toggle-project-panel"
        @click="toggleProjectPanel"
      >
        <Codicon name="layout-sidebar-left" :size="14" />
        Project
      </button>
      <button
        type="button"
        class="p-status"
        :class="{ 'is-on': layoutState.panel.cellEditor.visible }"
        data-testid="toggle-cell-editor-panel"
        @click="toggleCellEditorPanel"
      >
        <Codicon name="symbol-string" :size="14" />
        Cell editor
      </button>
      <button
        type="button"
        class="p-status"
        :class="{ 'is-on': layoutState.panel.operations.visible }"
        data-testid="toggle-operations-panel"
        @click="toggleOperationsPanel"
      >
        <Codicon name="layout-panel" :size="14" />
        Operations
      </button>
    </div>

    <div class="side p-sb-toggles">
      <span
        v-if="cacheSizeLabel"
        class="p-status"
        data-testid="cache-size"
        :title="cacheTitle"
      >
        <Codicon name="database" :size="10" />
        {{ cacheSizeLabel }}
      </span>
      <span
        class="p-status"
        data-testid="engine-status"
        :data-status="engineState.status"
        :title="engineState.lastPingMs !== null ? `${engineState.lastPingMs} ms` : undefined"
      >
        <Codicon
          name="circle-large-filled"
          :size="10"
          :style="{ color: engineState.status === 'ok' ? 'var(--kira-ok)' : 'var(--kira-error)' }"
        />
        engine {{ engineState.status }}
      </span>
      <button
        type="button"
        class="p-status"
        data-testid="open-settings"
        aria-label="Settings"
        @click="settingsOpen = true"
      >
        <Codicon name="settings-gear" :size="14" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
</template>
