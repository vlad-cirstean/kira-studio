<script setup lang="ts" generic="M extends string">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
import type { KeepAwakeStatus } from '../bridge/createCoreControl';
import type { ModeRegistry } from '../modes';
import ModeSwitcher from './ModeSwitcher.vue';
import TitleBarBase from './TitleBar.vue';
import TitleBarWindowActions from './TitleBarWindowActions.vue';

// Both apps' title bar: mode switcher, the two panel toggles, Settings, window actions. Stores and
// bridge calls stay app-side (each app's own instances), so state arrives as props and actions
// leave as events. `panelLabel` names the left panel's toggle (Connections / Repositories).
// `beforeModeChange` can veto a switch (Space's unsaved ADE workflow edits).
const props = defineProps<{
  order: readonly M[];
  modes: ModeRegistry<M>;
  active: M;
  panelLabel: string;
  projectVisible: boolean;
  operationsVisible: boolean;
  keepAwake: KeepAwakeStatus;
  beforeModeChange?: (mode: M) => boolean | Promise<boolean>;
}>();

const emit = defineEmits<{
  select: [mode: M];
  'toggle-project': [];
  'toggle-operations': [];
  'open-settings': [];
  'toggle-keep-awake': [];
  'new-window': [];
}>();

async function onSelect(mode: M): Promise<void> {
  if (props.beforeModeChange && !(await props.beforeModeChange(mode))) return;
  emit('select', mode);
}
</script>

<template>
  <TitleBarBase>
    <ModeSwitcher :order="order" :modes="modes" :active="active" @select="onSelect" />

    <!-- Every interactive child overrides --wails-draggable (wails-no-drag), or clicking it would
         also start a window drag (drag.ts reads the event target's computed style). Filled icon
         when a panel is visible, the codicon "-off" companion when it is not. -->
    <div class="flex items-center gap-0.5 ml-auto wails-no-drag">
      <TooltipIconButton
        :icon="projectVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
        :label="panelLabel"
        :icon-size="15"
        variant="title"
        size="title"
        :aria-pressed="projectVisible"
        data-testid="toggle-project-panel"
        @click="emit('toggle-project')"
      />
      <TooltipIconButton
        :icon="operationsVisible ? 'layout-panel' : 'layout-panel-off'"
        :label="t('common.module.operations.label')"
        :icon-size="15"
        variant="title"
        size="title"
        :aria-pressed="operationsVisible"
        data-testid="toggle-operations-panel"
        @click="emit('toggle-operations')"
      />
      <TooltipIconButton
        icon="settings-gear"
        :label="t('common.module.settings.label')"
        :icon-size="15"
        variant="title"
        size="title"
        data-testid="open-settings"
        @click="emit('open-settings')"
      />
      <TitleBarWindowActions
        :keep-awake="keepAwake"
        @toggle-keep-awake="emit('toggle-keep-awake')"
        @new-window="emit('new-window')"
      />
    </div>

    <template #settings>
      <slot name="settings" />
    </template>
  </TitleBarBase>
</template>
