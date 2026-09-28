<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { formatTimeAgo } from '@vueuse/core';
import { useTerminalModule } from '@workbench/terminal/module';
import TerminalHostView from '@workbench/terminal/TerminalHostView.vue';
import { computed, ref } from 'vue';
import { useTerminalsStore } from '../state/terminals';
import AdeActivityGlyph from './AdeActivityGlyph.vue';
import { ACTIVITY_LABEL } from './activity';
import { adeAgoOptions } from './ago';
import type { DialogCtx } from './dialogCompose';
import { resumeSpec, startSpec } from './dialogCompose';
import { useAdeSend } from './mutations';
import { useAdeUiStore } from './state/adeUi';
import type { QueuePanel, QueuePanelSession } from './useQueue';

// P129 Part 6 §0.18: the Agents tab (mockup 409-441) — one terminal tab per running session, a
// status strip, the mounted `TerminalHostView` (or a cross-window notice), a Send input, and the
// Stopped list.
const props = defineProps<{
  panel: QueuePanel;
  dialogCtx: DialogCtx | null;
  codeRepoId: string;
}>();

const adeUiStore = useAdeUiStore();
const terminalsStore = useTerminalsStore();
const terminalModule = useTerminalModule();
const sendMutation = useAdeSend(() => props.codeRepoId);
const sending = sendMutation.isPending;

// §0.20: falls back to the first running session when this item has no pick yet, or its pick names
// a session that has since stopped.
const activeSessionId = computed(() => {
  const picked = adeUiStore.agentTabByItem[`${props.codeRepoId}:${props.panel.id}`];
  if (picked && props.panel.running.some((s) => s.id === picked)) return picked;
  return props.panel.running[0]?.id ?? null;
});

const activeSession = computed<QueuePanelSession | null>(
  () => props.panel.running.find((s) => s.id === activeSessionId.value) ?? null,
);

function idLabel(claudeSessionId: string): string {
  return `claude ${claudeSessionId.slice(0, 8)}`;
}

function pickTab(id: string): void {
  adeUiStore.setAgentTab(props.codeRepoId, props.panel.id, id);
}

function onNewSession(): void {
  if (!props.dialogCtx) return;
  adeUiStore.openDialog(startSpec(props.dialogCtx, props.panel.id));
}

function onResume(sessionId: string): void {
  if (!props.dialogCtx) return;
  adeUiStore.openDialog(resumeSpec(props.dialogCtx, props.panel.id, sessionId));
}

const statusBarStyle = computed(() => {
  if (activeSession.value?.kind === 'input') {
    return { color: '#f0b85c', background: 'rgba(232,163,61,0.08)' };
  }
  return { color: '#9a9ca5', background: 'transparent' };
});

function lastActive(ms: number): string {
  return formatTimeAgo(new Date(ms), adeAgoOptions);
}

const message = ref('');
const sendError = ref<string | null>(null);

async function onSend(): Promise<void> {
  const session = activeSession.value;
  const text = message.value.trim();
  if (!session || !text) return;
  sendError.value = null;
  try {
    await sendMutation.mutateAsync({ sessionId: session.id, message: text });
    message.value = '';
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : 'Send failed';
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-[#0b0c0e]" data-testid="ade-agents-tab">
    <div
      role="tablist"
      aria-label="Claude Code sessions"
      class="flex shrink-0 border-b border-[#22252c] bg-[#101114]"
    >
      <button
        v-for="session in panel.running"
        :key="session.id"
        type="button"
        role="tab"
        :aria-selected="session.id === activeSessionId"
        class="flex h-[30px] items-center gap-1.5 border-0 border-r border-[#22252c] px-3 font-data text-kira-sm"
        :class="
          session.id === activeSessionId
            ? 'bg-[#0b0c0e] text-fg shadow-[inset_0_2px_0_#d97757]'
            : 'bg-transparent text-[#9a9ca5]'
        "
        :data-testid="`ade-agent-tab-${session.id}`"
        @click="pickTab(session.id)"
      >
        <AdeActivityGlyph :kind="session.kind" :size="12" />
        <span>{{ idLabel(session.claudeSessionId) }}</span>
      </button>
      <button
        type="button"
        class="flex w-8 shrink-0 items-center justify-center border-0 bg-transparent text-[#9a9ca5]"
        aria-label="New Claude Code session"
        title="New session"
        data-testid="ade-agents-new"
        @click="onNewSession"
      >
        <CodiconIcon name="add" :size="12" />
      </button>
    </div>

    <template v-if="activeSession">
      <div
        class="flex shrink-0 items-center gap-2 border-b border-[#22252c] px-3 py-1.5 text-kira-sm"
        :style="statusBarStyle"
      >
        <AdeActivityGlyph :kind="activeSession.kind" :size="14" />
        <span>{{ ACTIVITY_LABEL[activeSession.kind] }} &middot; {{ lastActive(activeSession.lastActiveAt) }}</span>
      </div>

      <TerminalHostView
        v-if="terminalsStore.terminalSession(activeSession.terminalId)"
        :key="activeSession.terminalId"
        :tab="{
          id: activeSession.terminalId,
          state: { codeRepoId, cwd: activeSession.cwd, command: '', launchKind: 'claude-code' },
        }"
        :deps="terminalModule.host"
        class="min-h-0 flex-1"
      />
      <div v-else class="flex-1 px-3.5 py-3 text-kira-sm text-[#9a9ca5]">Running in another window.</div>

      <div class="flex shrink-0 items-center gap-2 border-t border-[#22252c] px-3 py-2">
        <label for="ade-agent-input" class="sr-only">Message Claude Code</label>
        <Input
          id="ade-agent-input"
          v-model="message"
          placeholder="message claude&hellip;"
          class="h-[26px] flex-1 border-transparent bg-transparent font-data text-kira-sm"
          @keydown.enter="onSend"
        />
        <Button
          variant="dialog"
          size="sm"
          class="h-[26px] shrink-0 px-2.5"
          :disabled="sending || !message.trim()"
          @click="onSend"
        >
          Send
        </Button>
      </div>
      <span v-if="sendError" class="px-3.5 pb-2 text-kira-sm text-[#f28b7d]">{{ sendError }}</span>
    </template>
    <div v-else class="flex-1 p-3.5 text-kira-sm text-[#9a9ca5]" data-testid="ade-agents-empty">
      No running agents.
    </div>

    <div
      v-if="panel.stopped.length"
      class="flex flex-col gap-1 border-t border-[#22252c] bg-[#121316] px-3 pb-2.5 pt-2"
    >
      <div class="text-kira-sm text-[#9a9ca5]">Stopped</div>
      <div
        v-for="stopped in panel.stopped"
        :key="stopped.id"
        class="flex items-center gap-2 text-kira-sm"
        data-testid="ade-agents-stopped-row"
      >
        <span class="size-1.5 shrink-0 rounded-[1px] bg-[#4a4d56]" />
        <span class="flex-1 font-data text-kira-sm">{{ idLabel(stopped.claudeSessionId) }}</span>
        <span class="text-[#9a9ca5]">{{ lastActive(stopped.lastActiveAt) }}</span>
        <Button variant="dialog" size="sm" class="h-[22px] px-2" @click="onResume(stopped.id)">Resume</Button>
      </div>
    </div>
  </div>
</template>
