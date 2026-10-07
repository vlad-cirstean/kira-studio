<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { useTerminalModule } from '@workbench/terminal/module';
import TerminalHostView from '@workbench/terminal/TerminalHostView.vue';
import { computed, ref } from 'vue';
import { useTerminalsStore } from '../../../state/terminals';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTIVITY_LABEL } from '../activity';
import { adeAgoOptions } from '../ago';
import { useFocusSession } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { TONE } from '../tones';
import AdeSessionId from './AdeSessionId.vue';
import type { SessionView } from './sessionView';

// An interactive session: the terminal when this window holds it, else a Show button that raises
// the window that does.
const props = defineProps<{ view: SessionView }>();

const terminals = useTerminalsStore();
const terminal = useTerminalModule();
const focus = useFocusSession();
const ui = useAdeBoardUiStore();
const missing = ref(false);
const ago = useTimeAgo(() => props.view.session.lastActiveAt, adeAgoOptions);

const held = computed(() => terminals.terminalSession(props.view.session.terminalId) !== undefined);
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
      :class="needsYou ? '' : 'text-muted-foreground'"
      :style="needsYou ? { color: TONE.amber[1], background: `color-mix(in srgb, ${TONE.amber[2]} 8%, transparent)` } : undefined"
    >
      <AdeActivityIcon :kind="view.kind" :size="14" />
      <span class="truncate" data-testid="ade-tui-label">interactive · {{ ACTIVITY_LABEL[view.kind] }} · {{ ago }}</span>
      <AdeSessionId class="ml-auto" :id="view.session.claudeSessionId" />
    </div>
    <TerminalHostView v-if="held" :key="view.session.terminalId" class="min-h-0 flex-1" :tab="tab" :deps="terminal.host" />
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
