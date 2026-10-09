<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useDateFormat, useTimeAgo } from '@vueuse/core';
import { useAutomationsModule } from '@workbench/automations/module';
import TerminalHostView from '@workbench/terminal/TerminalHostView.vue';
import { computed, ref } from 'vue';
import { useMobileTerminalsStore } from '../../../state/mobileTerminals';
import { useTerminalsStore } from '../../../state/terminals';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTIVITY_LABEL } from '../activity';
import { adeAgoOptions } from '../ago';
import { useFocusSession } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeSessionId from './AdeSessionId.vue';
import type { SessionView } from './sessionView';

// An interactive session: the terminal when this window holds it, else a Show button that raises
// the window that does.
const props = defineProps<{ view: SessionView }>();

const terminals = useTerminalsStore();
const phones = useMobileTerminalsStore();
const terminal = useAutomationsModule();
const focus = useFocusSession();
const ui = useAdeBoardUiStore();
const missing = ref(false);
const ago = useTimeAgo(() => props.view.session.lastActiveAt, adeAgoOptions);

const held = computed(() => terminals.terminalSession(props.view.session.terminalId) !== undefined);
const hold = computed(() => phones.holdOf(props.view.session.terminalId));
const returnsAt = useDateFormat(() => hold.value?.returnsAt ?? 0, 'HH:mm');
const needsYou = computed(() => props.view.kind === 'input');
const tab = computed(() => ({
  id: props.view.session.terminalId,
  state: {
    codeRepoId: '',
    cwd: props.view.session.cwd,
    command: '',
    launchKind: 'claude-code' as const,
  },
}));

async function show(): Promise<void> {
  missing.value = false;
  const shown = await focus
    .mutateAsync({ sessionId: props.view.session.id, taskId: props.view.session.taskId })
    .catch(() => false);
  if (!shown) missing.value = true;
  else ui.sessionId = props.view.session.id;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-tui-pane">
    <div
      class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-kira-md"
      :class="needsYou ? 'bg-tone-amber-solid/8 text-tone-amber' : 'text-muted-foreground'"
    >
      <AdeActivityIcon :kind="view.kind" :size="14" />
      <span class="truncate" data-testid="ade-tui-label">interactive · {{ ACTIVITY_LABEL[view.kind] }} · {{ ago }}</span>
      <AdeSessionId class="ml-auto" :id="view.session.claudeSessionId" />
    </div>
    <div v-if="held" class="relative flex min-h-0 flex-1 flex-col">
      <TerminalHostView :key="view.session.terminalId" class="min-h-0 flex-1" :tab="tab" :deps="terminal.host" />
      <div
        v-if="hold"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/90 p-4 text-center text-kira-md"
        data-testid="ade-tui-phone-overlay"
      >
        <p class="m-0">Controlled from {{ hold.label }}</p>
        <p v-if="!hold.connected" class="m-0 text-muted-foreground" data-testid="ade-tui-phone-offline">
          Phone offline, returns here at {{ returnsAt }}
        </p>
        <Button variant="dialog" size="xs" class="px-2.5" data-testid="ade-tui-reconnect" @click="phones.reclaim(view.session.terminalId)">
          Reconnect here
        </Button>
      </div>
    </div>
    <div v-else class="flex flex-col items-start gap-2 p-3 text-kira-md" data-testid="ade-tui-elsewhere">
      <Button variant="dialog" size="xs" class="px-2.5" data-testid="ade-tui-show" @click="show">
        Show
      </Button>
      <p v-if="missing" class="m-0 text-muted-foreground" data-testid="ade-tui-missing">
        This session's terminal is not open in any window.
      </p>
    </div>
  </div>
</template>
