<script setup lang="ts">
import type { AppMode } from '@shared/domain/mode';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import { computed } from 'vue';
import { control } from '../bridge/control';
import { useKeepAwakeStore } from '../state/keepAwake';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { useSettingsStore } from '../state/settings';
import { MODES } from './modes';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, now a thin composition over the shared bar
// chrome (height/insets/background/Teleport, packages/workbench/src/components/TitleBar.vue) —
// this file keeps exactly the per-app content: the mode switcher, the panel-toggle/keep-awake/
// new-window action buttons, and the SettingsDialog it teleports.
const keepAwakeStore = useKeepAwakeStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const modeStore = useModeStore();

// P100 Part 2: two peer modules again — Studio, Api — Git (P67b §4.3's third) moved to
// apps/kira-space wholesale. P91 OQ-1: Terminal still joins last, the plan's own stated default.
const MODE_ORDER: AppMode[] = ['studio', 'api', 'terminal'];

function onClick(mode: AppMode): void {
  modeStore.setMode(mode);
}

// P92 item 3: no toast channel in the title bar — a rejection (e.g. a `-tags server` build) is
// logged, not surfaced.
function onNewWindow(): void {
  control.windowsOpenNew().catch((err: unknown) => {
    console.error('new window', err);
  });
}

// P87 §8.2: the button shows only the manual source.
function onToggleKeepAwake(): void {
  keepAwakeStore.setKeepAwakeManual(!keepAwakeStore.status.manual).catch((err: unknown) => {
    console.error('toggle keep-awake', err);
  });
}

// §8.3: aria-pressed plus this state-naming tooltip carry what a missing coffee-off glyph would
// have — @vscode/codicons ships no such glyph, so the button can't also swap its icon the way the
// Connections/Operations toggles do.
const keepAwakeTooltip = computed(() => {
  if (keepAwakeStore.status.error) return `Keep awake failed: ${keepAwakeStore.status.error}`;
  return keepAwakeStore.status.manual
    ? 'Keeping this Mac awake — click to stop'
    : 'Keep this Mac awake';
});
</script>

<template>
  <TitleBarBase>
    <!-- No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read
         as redundant next to the mode switcher). Centered on the bar's true full width via
         absolute positioning, deliberately NOT `justify-content: center` inside the flex row —
         that would center within the *padded* box, not the window, and reads visibly off-centre. -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-0.5">
      <!-- P15 D9: px-3 (12px) -- the tab chip's own metrics (--kira-h-md/--kira-t-sm, 26px/11px)
           inside a 38px bar leaves 6px of clearance, the same --kira-s-3 the bar already uses as
           its own right padding. wails-no-drag: isDraggableEvent (drag.ts) reads the event
           target's computed style, so every interactive child of the shared, wails-drag-carrying
           TitleBar root must explicitly override it, or clicking a mode tab would also start a
           window drag. -->
      <button
        v-for="mode in MODE_ORDER"
        :key="mode"
        type="button"
        class="h-control-lg inline-flex items-center gap-1 px-3 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm wails-no-drag"
        :class="[
          modeStore.active === mode ? 'bg-elevated border-border-strong text-fg' : 'border-transparent text-muted-foreground hover:bg-hover',
          { 'is-active': modeStore.active === mode },
        ]"
        data-testid="mode-tab"
        :data-mode="mode"
        @click="onClick(mode)"
      >
        <!-- P22 D6: rendered at the icon's own 16px design size (--kira-icon-box) — the glyph fills
             its box instead of leaving per-glyph advance slack at 13px (F9(a)). Mode-tab-local. -->
        <span
          class="size-4 flex items-center justify-center shrink-0 leading-3.5"
          data-testid="mode-tab-icon"
          ><CodiconIcon :name="MODES[mode].icon" :size="16"
        /></span>
        <span class="mode-label leading-3.5">{{ MODES[mode].label }}</span>
      </button>
    </div>

    <!-- Panel toggles and Settings read as title-bar chrome alongside the mode switcher. Filled
         icon + accent colour when a panel is visible, the codicon "-off" companion glyph plus the
         muted colour when it's not. -->
    <div class="flex items-center gap-0.5 ml-auto wails-no-drag">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="title"
            size="title"
            :aria-pressed="layoutStore.panel.project.visible"
            data-testid="toggle-project-panel"
            aria-label="Connections"
            @click="layoutStore.toggleProjectPanel"
          >
            <CodiconIcon
              :name="layoutStore.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
              :size="15"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Connections</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="title"
            size="title"
            :aria-pressed="layoutStore.panel.operations.visible"
            data-testid="toggle-operations-panel"
            aria-label="Operations"
            @click="layoutStore.toggleOperationsPanel"
          >
            <CodiconIcon
              :name="layoutStore.panel.operations.visible ? 'layout-panel' : 'layout-panel-off'"
              :size="15"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Operations</TooltipContent>
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
      <Tooltip v-if="keepAwakeStore.status.supported">
        <TooltipTrigger as-child>
          <Button
            variant="title"
            size="title"
            :aria-pressed="keepAwakeStore.status.manual"
            data-testid="toggle-keep-awake"
            aria-label="Keep this Mac awake"
            @click="onToggleKeepAwake"
          >
            <CodiconIcon name="coffee" :size="15" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ keepAwakeTooltip }}</TooltipContent>
      </Tooltip>
      <Button
        variant="title"
        size="title-labelled"
        data-testid="new-window"
        @click="onNewWindow"
      >
        <CodiconIcon name="empty-window" :size="15" />
        <span>New window</span>
      </Button>
    </div>

    <template #settings>
      <SettingsDialog v-if="settingsStore.settingsOpen" @close="settingsStore.settingsOpen = false" />
    </template>
    <!-- CRITICAL (D2): --wails-draggable inherits from the shared TitleBar's own root, and
         isDraggableEvent (drag.ts) reads the event *target's* computed style — every interactive
         child here must explicitly override it (wails-no-drag, inline on the button/action-row
         above), or clicking a mode tab would also start a window drag. P110 I2-18: the mode tab's
         hover now lives in the `:class` ternary above (`hover:bg-hover` only in the inactive
         branch), replacing `.mode-tab:hover:not(.is-active)` -- `is-active` itself stays a real
         class (terminal-module.spec.ts/mode-switch.spec.ts/etc. assert `toHaveClass(/is-active/)`
         on it), `mode-tab` was marker-only and dropped. -->
  </TitleBarBase>
</template>
