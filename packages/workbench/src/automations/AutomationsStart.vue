<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import ModuleStart from '../components/ModuleStart.vue';
import { useNewTerminal } from './module';

// MainView.vue's own fallback when the Automations module has no active tab — the state a
// fresh install always opens in. StudioStart.vue verbatim in shape: an EmptyState with one primary
// action, disabled while the resolved home directory isn't known yet. `useNewTerminal` (module.ts)
// holds the one cwd-unavailable guard, shared with the tab strip's own "+" menu
// (AutomationsNewTab.vue).
const { canOpen, open } = useNewTerminal();
</script>

<template>
  <ModuleStart
    icon="terminal-bash"
    :title="t('automations.start.none.empty')"
    :description="t('automations.start.none.emptyHint')"
    data-testid="automations-start"
  >
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
            {{ t('common.newTerminal.label') }}
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ t('automations.start.homeUnavailable.tooltip') }}</TooltipContent>
    </Tooltip>
  </ModuleStart>
</template>
