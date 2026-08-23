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
    <!-- LAW 14: the left readout answers "where is the caret" and nothing else — every fact a
         toolbar already carries (row counts, pending edits, durations) stays there instead of
         accumulating here too. Not yet wired per-view; "no selection" is the honest default. -->
    <div class="side">
      <span class="p-status" data-testid="caret-status">
        <span class="mono xs muted">no selection</span>
      </span>
    </div>

    <div class="side">
      <span v-if="cacheSizeLabel" class="p-status" data-testid="cache-size" :title="cacheTitle">
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

      <!-- Panel toggles live here, icon-only, with Settings — separated from the read-outs
           above by a hairline, so "things I toggle" and "things I read" never mix. -->
      <span class="p-sb-toggles">
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.project.visible }"
          title="Connections"
          data-testid="toggle-project-panel"
          @click="toggleProjectPanel"
        >
          <Codicon name="layout-sidebar-left" :size="14" />
        </button>
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.cellEditor.visible }"
          title="Cell editor"
          data-testid="toggle-cell-editor-panel"
          @click="toggleCellEditorPanel"
        >
          <Codicon name="symbol-string" :size="14" />
        </button>
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.operations.visible }"
          title="Operations"
          data-testid="toggle-operations-panel"
          @click="toggleOperationsPanel"
        >
          <Codicon name="layout-panel" :size="14" />
        </button>
        <button
          type="button"
          class="p-status"
          title="Settings"
          data-testid="open-settings"
          aria-label="Settings"
          @click="settingsOpen = true"
        >
          <Codicon name="settings-gear" :size="14" />
        </button>
      </span>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
</template>
