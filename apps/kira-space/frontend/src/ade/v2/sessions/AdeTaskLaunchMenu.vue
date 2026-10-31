<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { useAgentInfo } from '@workbench/agent/agentInfo';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import type { Gate, LaunchTarget } from '../board/taskLaunch';
import { useTaskLaunch } from './useTaskLaunch';

// The plus on a task: per worktree, a terminal (Git module) or an agent session with no first message.
const props = defineProps<{ taskId: string; branchId?: string; size: 'card' | 'bar' }>();

const { info } = useAgentInfo();
const { targets, pending, openTerminal, startAgent } = useTaskLaunch(
  () => props.taskId,
  () => props.branchId,
);

const usable = computed(() => targets.value.some((x) => x.worktree !== ''));
const several = computed(() => targets.value.length > 1);
const agentLabel = computed(() =>
  t('space.ade.taskLaunch.agent.label', { agent: info.value.productLabel }),
);
const label = (x: LaunchTarget): string =>
  t('common.dotPair.label', { first: x.repo, second: x.branch });
const reason = (g: Gate): string => (g.reason ? t(g.reason) : '');
const triggerClass = computed(() => (props.size === 'card' ? 'size-4.5 shrink-0' : 'shrink-0'));
</script>

<template>
  <DropdownMenu v-if="usable">
    <AdeTip :text="t('space.ade.taskLaunch.trigger.tooltip')">
      <DropdownMenuTrigger as-child>
        <Button
          variant="toolbar"
          size="kira-icon"
          :class="triggerClass"
          :pending="pending"
          :aria-label="t('space.ade.taskLaunch.trigger.tooltip')"
          data-testid="ade-task-launch"
          @click.stop
        >
          <CodiconIcon name="add" :size="13" />
        </Button>
      </DropdownMenuTrigger>
    </AdeTip>
    <DropdownMenuContent align="end" data-testid="ade-task-launch-menu">
      <template v-if="several">
        <DropdownMenuLabel>{{ t('common.module.terminal.label') }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="x in targets"
          :key="`t-${x.branchId}`"
          :disabled="x.terminal.disabled"
          :data-testid="`ade-task-launch-terminal-${x.branchId}`"
          @select="openTerminal(x)"
        >
          {{ label(x) }}
          <span
            v-if="x.terminal.reason"
            class="ml-auto text-muted-foreground"
            data-testid="ade-task-launch-reason"
            >{{
              reason(x.terminal)
            }}</span
          >
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{{ agentLabel }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="x in targets"
          :key="`a-${x.branchId}`"
          :disabled="x.agent.disabled"
          :data-testid="`ade-task-launch-agent-${x.branchId}`"
          @select="startAgent(x)"
        >
          {{ label(x) }}
          <span
            v-if="x.agent.reason"
            class="ml-auto text-muted-foreground"
            data-testid="ade-task-launch-reason"
            >{{
              reason(x.agent)
            }}</span
          >
        </DropdownMenuItem>
      </template>
      <template v-else>
        <DropdownMenuItem
          v-for="x in targets"
          :key="`t-${x.branchId}`"
          :disabled="x.terminal.disabled"
          :data-testid="`ade-task-launch-terminal-${x.branchId}`"
          @select="openTerminal(x)"
        >
          {{ t('common.module.terminal.label') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-for="x in targets"
          :key="`a-${x.branchId}`"
          :disabled="x.agent.disabled"
          :data-testid="`ade-task-launch-agent-${x.branchId}`"
          @select="startAgent(x)"
        >
          {{ agentLabel }}
          <span
            v-if="x.agent.reason"
            class="ml-auto text-muted-foreground"
            data-testid="ade-task-launch-reason"
            >{{
              reason(x.agent)
            }}</span
          >
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
  <TooltipIconButton
    v-else
    icon="add"
    :label="t('space.ade.taskLaunch.reason.noWorktree.label')"
    :class="triggerClass"
    disabled-trigger
    disabled
    data-testid="ade-task-launch"
    @click.stop
  />
</template>
