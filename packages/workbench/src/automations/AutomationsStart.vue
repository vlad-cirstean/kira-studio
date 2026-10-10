<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
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
      <Empty>
        <EmptyHeader>
          <EmptyMedia><CodiconIcon name="terminal-bash" :size="24" /></EmptyMedia>
          <EmptyTitle>No terminal open</EmptyTitle>
          <EmptyDescription>Run a script from the panel, or open a terminal.</EmptyDescription>
        </EmptyHeader>
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
      </Empty>
    </div>
  </div>
</template>
