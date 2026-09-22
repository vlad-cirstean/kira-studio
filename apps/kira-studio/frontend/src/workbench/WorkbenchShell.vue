<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import MainView from '@workbench/components/MainView.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import WorkbenchShellBase from '@workbench/components/WorkbenchShell.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref } from 'vue';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';
import { MODES } from './modes';
import OperationsPanel from './panels/OperationsPanel.vue';
import StatusBar from './StatusBar.vue';

// P103 Part 2 (§5.4): Kira Studio's own WorkbenchShell.vue, now a thin composition over the shared
// grid/splitters/TabStrip/MainView package components — this file keeps exactly the per-app
// content those components' slots need: the mode-scoped left-panel lookup (D6/C6), the Operations
// dock, and the Terminal module's own "+" menu (the old panels/TabStrip.vue's own
// `terminalModuleMenuItems`/`onNewTab`, moved here verbatim — real per-app logic, not the shared
// strip's own).
const modeStore = useModeStore();
const layoutStore = useLayoutStore();
const terminalsStore = useTerminalsStore();
const contextMenuStore = useContextMenuStore();

// P1 D6/C6: the left panel mounts whichever mode is active's own self-contained panel component.
const activeModePanel = computed(() => MODES[modeStore.active].panel);
// P1 D6/C6: MainView.vue's fallback when the active mode has no active tab.
const modeStart = computed(() => MODES[modeStore.active].start);

// P91 §8: the "+" shows with zero tabs in the Terminal module — its own normal initial state. This
// app has exactly one mode that ever opens a tab through this button.
const showNewTab = computed(() => modeStore.active === 'terminal');
const newTabBtn = ref<HTMLButtonElement | null>(null);

// P91 §8: the Terminal module's own "+" menu — one plain, unscoped session at the resolved home
// directory.
function terminalModuleMenuItems(): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-terminal',
      label: 'Terminal',
      icon: 'terminal-bash',
      disabled: terminalsStore.terminalDefaults.cwd === '',
      run: () => {
        openTerminalTab({ workspaceId: 'terminal', cwd: terminalsStore.terminalDefaults.cwd });
      },
    },
  ];
}

// P83 §9: the tab strip's own "+" — a dropdown anchored under the button, not the click point.
function onNewTab(): void {
  const btn = newTabBtn.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  contextMenuStore.openContextMenuAt(rect.left, rect.bottom + 2, terminalModuleMenuItems());
}
</script>

<template>
  <WorkbenchShellBase
    :project-visible="layoutStore.panel.project.visible"
    :project-width="layoutStore.panel.project.width"
    :ops-visible="layoutStore.panel.operations.visible"
    :ops-height="layoutStore.panel.operations.height"
    @resize-project="layoutStore.setProjectWidth"
    @resize-ops="layoutStore.setOperationsHeight"
  >
    <template #panel>
      <component :is="activeModePanel" />
    </template>
    <template #tab-strip>
      <TabStrip>
        <template #new-tab>
          <div v-if="showNewTab" class="tab-strip-actions" data-testid="tab-strip-actions">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  ref="newTabBtn"
                  type="button"
                  class="tab-new"
                  aria-label="New tab"
                  aria-haspopup="menu"
                  data-testid="tab-strip-new"
                  @click="onNewTab"
                >
                  <CodiconIcon name="add" :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New tab</TooltipContent>
            </Tooltip>
          </div>
        </template>
      </TabStrip>
    </template>
    <template #main>
      <MainView>
        <template #empty>
          <component :is="modeStart" />
        </template>
      </MainView>
    </template>
    <template #dock>
      <OperationsPanel />
    </template>
    <template #status>
      <StatusBar />
    </template>
  </WorkbenchShellBase>
</template>
