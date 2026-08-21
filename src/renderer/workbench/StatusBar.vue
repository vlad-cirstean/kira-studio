<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import SettingsDialog from './SettingsDialog.vue';
import { engineState } from './state/engine';
import { layoutState, toggleOperationsPanel, toggleProjectPanel } from './state/layout';
import { settingsOpen } from './state/settings';
</script>

<template>
  <div class="status-bar" :style="{ height: 'var(--kira-statusbar-h)' }">
    <div class="side">
      <span
        class="engine-indicator"
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
        class="toggle-button"
        data-testid="toggle-project-panel"
        aria-label="Toggle Project Panel"
        :aria-pressed="layoutState.panel.project.visible"
        @click="toggleProjectPanel"
      >
        <Codicon
          :name="layoutState.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
          :size="14"
        />
      </button>
      <button
        type="button"
        class="toggle-button"
        data-testid="toggle-operations-panel"
        aria-label="Toggle Operations Panel"
        :aria-pressed="layoutState.panel.operations.visible"
        @click="toggleOperationsPanel"
      >
        <Codicon
          :name="layoutState.panel.operations.visible ? 'layout-panel' : 'layout-panel-off'"
          :size="14"
        />
      </button>
      <button
        type="button"
        class="toggle-button"
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

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px;
  font-size: 11px;
  color: var(--kira-fg-muted);
}

.side {
  display: flex;
  align-items: center;
  gap: 4px;
}

.engine-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toggle-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}

.toggle-button:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}
</style>
