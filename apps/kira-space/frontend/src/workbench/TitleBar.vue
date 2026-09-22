<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { useLayoutStore } from '../state/layout';
import { useSettingsStore } from '../state/settings';
import SettingsDialog from './SettingsDialog.vue';

// P100 Part 2: Kira Studio's own TitleBar.vue, trimmed — no mode switcher (one module, so no
// MODES row at all, unlike TitleBar.vue's own doc comment on that row's history), no Operations
// panel toggle (no ops log here) and no keep-awake toggle (this app has no KeepAwakeService,
// apps/kira-space/main.go's own Services list). "New window" is dropped too: this app's Go menu
// already binds Cmd+Shift+N to ItemNewWindow entirely on the Go side
// (internal/shell/menutemplate.go) — Studio's own control.windowsOpenNew() has no counterpart
// here since this app has no WindowsService, and none is needed for a menu-only affordance.
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
</script>

<template>
  <div class="title-bar">
    <div class="title-bar-actions">
      <button
        type="button"
        class="title-action"
        :class="{ 'is-on': layoutStore.panel.project.visible }"
        v-tooltip="'Repositories'"
        data-testid="toggle-project-panel"
        @click="layoutStore.toggleProjectPanel"
      >
        <CodiconIcon
          :name="layoutStore.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
          :size="15"
        />
      </button>
      <button
        type="button"
        class="title-action"
        v-tooltip="'Settings'"
        data-testid="open-settings"
        aria-label="Settings"
        @click="settingsStore.settingsOpen = true"
      >
        <CodiconIcon name="settings-gear" :size="15" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsStore.settingsOpen" @close="settingsStore.settingsOpen = false" />
  </Teleport>
</template>

<style scoped>
@reference "@theme/base.css";

.title-bar {
  @apply relative flex items-center shrink-0;
  --wails-draggable: drag;
  height: var(--kira-titlebar-h);
  min-height: var(--kira-titlebar-h);
  padding-left: var(--kira-titlebar-inset-left);
  padding-right: var(--kira-s-3);
  background: var(--kira-bg-chrome);
}

.title-bar-actions {
  @apply flex items-center gap-0.5 ml-auto;
  --wails-draggable: none;
}

.title-action {
  @apply inline-flex items-center justify-center cursor-pointer rounded-[var(--kira-radius-sm)];
  --wails-draggable: none;
  height: var(--kira-h-sm);
  width: var(--kira-h-sm);
  border: var(--kira-border-width) solid transparent;
  background: none;
  color: var(--kira-fg-muted);
}
.title-action:hover {
  background: var(--kira-hover);
}
.title-action.is-on {
  background: var(--kira-bg-elevated);
  border-color: var(--kira-border-strong);
  color: var(--kira-fg);
}
.title-action.is-on:hover {
  background: var(--kira-hover);
}
</style>
