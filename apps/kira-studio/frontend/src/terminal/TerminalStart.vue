<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

const terminalsStore = useTerminalsStore();

// P91 §12: MainView.vue's own fallback when the Terminal module has no active tab — the state a
// fresh install always opens in. StudioStart.vue verbatim in shape: an EmptyState with one primary
// action, disabled while the resolved home directory (§7.2) isn't known yet.
function onNewTerminal(): void {
  if (terminalsStore.terminalDefaults.cwd === '') return;
  openTerminalTab({ workspaceId: 'terminal', cwd: terminalsStore.terminalDefaults.cwd });
}
</script>

<template>
  <div class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="terminal-start">
    <div class="w-105 max-w-full">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="terminal-bash" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No terminal open</AlertTitle>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Tooltip :disabled="terminalsStore.terminalDefaults.cwd !== ''">
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger :class="{ 'pointer-events-none': terminalsStore.terminalDefaults.cwd === '' }">
                <Button
                  variant="dialog-primary"
                  size="kira-lg"
                  data-testid="terminal-start-new"
                  :disabled="terminalsStore.terminalDefaults.cwd === ''"
                  @click="onNewTerminal"
                >
                  <CodiconIcon name="terminal-bash" :size="13" />
                  New terminal
                </Button>
              </TooltipDisabledTrigger>
            </TooltipTrigger>
            <TooltipContent>Home directory unavailable</TooltipContent>
          </Tooltip>
        </AlertAction>
      </Alert>
    </div>
  </div>
</template>
