<script setup lang="ts">
import { computed } from 'vue';
import { cacheStatsState } from '../state/cacheStats';
import { settingsOpen } from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import SettingsDialog from './SettingsDialog.vue';
import { engineState } from './state/engine';
import { layoutState, toggleOperationsPanel, toggleProjectPanel } from './state/layout';

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
      <span v-if="cacheSizeLabel" class="p-status" data-testid="cache-size" v-tooltip="cacheTitle">
        <CodiconIcon name="database" :size="10" />
        {{ cacheSizeLabel }}
      </span>
      <span
        class="p-status"
        data-testid="engine-status"
        :data-status="engineState.status"
        v-tooltip="engineState.lastPingMs !== null ? `${engineState.lastPingMs} ms` : undefined"
      >
        <CodiconIcon
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
          v-tooltip="'Connections'"
          data-testid="toggle-project-panel"
          @click="toggleProjectPanel"
        >
          <CodiconIcon name="layout-sidebar-left" :size="14" />
        </button>
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.operations.visible }"
          v-tooltip="'Operations'"
          data-testid="toggle-operations-panel"
          @click="toggleOperationsPanel"
        >
          <CodiconIcon name="layout-panel" :size="14" />
        </button>
        <button
          type="button"
          class="p-status"
          v-tooltip="'Settings'"
          data-testid="open-settings"
          aria-label="Settings"
          @click="settingsOpen = true"
        >
          <CodiconIcon name="settings-gear" :size="14" />
        </button>
      </span>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
</template>
