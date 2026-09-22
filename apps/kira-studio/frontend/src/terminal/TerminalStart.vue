<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import EmptyState from '@theme/primitives/EmptyState.vue';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

const terminalsStore = useTerminalsStore();

// P91 §12: MainView.vue's own fallback when the Terminal module has no active tab — the state a
// fresh install always opens in. GitStart.vue verbatim in shape: an EmptyState with one primary
// action, disabled while the resolved home directory (§7.2) isn't known yet.
function onNewTerminal(): void {
  if (terminalsStore.terminalDefaults.cwd === '') return;
  openTerminalTab({ workspaceId: 'terminal', cwd: terminalsStore.terminalDefaults.cwd });
}
</script>

<template>
  <div class="start" data-testid="terminal-start">
    <div class="start-inner">
      <EmptyState icon="terminal-bash" label="No terminal open">
        <Tooltip :disabled="terminalsStore.terminalDefaults.cwd !== ''">
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': terminalsStore.terminalDefaults.cwd === '' }">
              <button
                type="button"
                class="p-dlgbtn primary"
                data-testid="terminal-start-new"
                :disabled="terminalsStore.terminalDefaults.cwd === ''"
                @click="onNewTerminal"
              >
                <span class="icon-box"><CodiconIcon name="terminal-bash" :size="13" /></span>
                New terminal
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Home directory unavailable</TooltipContent>
        </Tooltip>
      </EmptyState>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.start {
  @apply flex-1 min-h-0 flex items-center justify-center overflow-auto p-4;
}

.start-inner {
  @apply w-[420px] max-w-full;
}
</style>
