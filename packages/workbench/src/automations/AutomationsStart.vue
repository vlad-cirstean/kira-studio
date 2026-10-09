<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useNewTerminal } from './module';

// P91 §12: MainView.vue's own fallback when the Automations module has no active tab — the state a
// fresh install always opens in. StudioStart.vue verbatim in shape: an EmptyState with one primary
// action, disabled while the resolved home directory (§7.2) isn't known yet. P128 §2.4: moved to
// the shared automations module — `useNewTerminal` (module.ts) holds the one cwd-unavailable guard,
// shared with the tab strip's own "+" menu (AutomationsNewTab.vue).
const { canOpen, open } = useNewTerminal();
</script>

<template>
  <div class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="automations-start">
    <div class="w-105 max-w-full">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="terminal-bash" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No terminal open</AlertTitle>
        <AlertDescription class="text-kira-sm text-muted-foreground">
          Run a script from the panel, or open a terminal.
        </AlertDescription>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Tooltip :disabled="canOpen">
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger :class="{ 'pointer-events-none': !canOpen }">
                <Button
                  variant="dialog-primary"
                  size="kira-lg"
                  data-testid="automations-start-new"
                  :disabled="!canOpen"
                  @click="open"
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
