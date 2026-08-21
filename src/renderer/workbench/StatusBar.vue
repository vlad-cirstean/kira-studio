<script setup lang="ts">
import { ref } from 'vue';
import Codicon from '../theme/Codicon.vue';
import SettingsDialog from './SettingsDialog.vue';
import { engineState } from './state/engine';
import { layoutState, toggleOperationsPanel, toggleProjectPanel } from './state/layout';

const settingsOpen = ref(false);
</script>

<template>
  <div class="status-bar" :style="{ height: 'var(--kira-statusbar-h)' }">
    <div class="side">
      <button
        type="button"
        class="toggle-button"
        :class="{ active: layoutState.panel.project.visible }"
        data-testid="toggle-project-panel"
        @click="toggleProjectPanel"
      >
        <Codicon name="layout-sidebar-left" :size="14" />
        Project
      </button>
      <button
        type="button"
        class="toggle-button"
        :class="{ active: layoutState.panel.operations.visible }"
        data-testid="toggle-operations-panel"
        @click="toggleOperationsPanel"
      >
        <Codicon name="layout-panel" :size="14" />
        Operations
      </button>
    </div>

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
  justify-content: space-between;
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
  gap: 4px;
  padding: 0 6px;
  height: 18px;
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}

.toggle-button:hover {
  background: var(--kira-hover);
}

.toggle-button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}
</style>
