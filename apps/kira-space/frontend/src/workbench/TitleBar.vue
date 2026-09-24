<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import { useLayoutStore } from '../state/layout';
import { useSettingsStore } from '../state/settings';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, trimmed — no mode switcher (one module), no
// Operations panel toggle, no keep-awake toggle, no "New window" (this app's Go menu already binds
// Cmd+Shift+N to ItemNewWindow entirely on the Go side). Now a thin composition over the shared bar
// chrome (packages/workbench/src/components/TitleBar.vue).
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
</script>

<template>
  <TitleBarBase>
    <div class="flex items-center gap-0.5 ml-auto wails-no-drag">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="title"
            size="title"
            :aria-pressed="layoutStore.panel.project.visible"
            data-testid="toggle-project-panel"
            aria-label="Repositories"
            @click="layoutStore.toggleProjectPanel"
          >
            <CodiconIcon
              :name="layoutStore.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
              :size="15"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Repositories</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="title"
            size="title"
            data-testid="open-settings"
            aria-label="Settings"
            @click="settingsStore.settingsOpen = true"
          >
            <CodiconIcon name="settings-gear" :size="15" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>

    <template #settings>
      <SettingsDialog v-if="settingsStore.settingsOpen" @close="settingsStore.settingsOpen = false" />
    </template>
  </TitleBarBase>
</template>
