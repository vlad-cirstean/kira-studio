<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component but
// must lose nothing; TerminalHostView owns the mount-into-container lifecycle (never calls
// term.open() twice).
//
// P100 Part 2 / P107 I2-19: this used to be a full duplicate of Kira Space's own
// RepoTerminalView.vue (two Vite apps, no shared package boundary for a whole component) — now
// both wrap @workbench/terminal/TerminalHostView.vue, which owns the template/style/composable
// call genuinely identical between them. This file's own remaining job: build `deps` from this
// app's stores, and the one real difference — the Claude Code hooks banner below, passed as
// TerminalHostView's default slot, since Kira Space's own TerminalService has no AgentHooks
// integration.
import TerminalHostView, { type TerminalHostDeps } from '@workbench/terminal/TerminalHostView.vue';
import { computed, ref } from 'vue';
import { useAgentHooksStore } from '../../state/agentHooks';
import { useSettingsStore } from '../../state/settings';
import type { TerminalTabRecord } from '../../state/tabDomain';
import { useTerminalsStore } from '../../state/terminals';

const props = defineProps<{ tab: TerminalTabRecord }>();
const settingsStore = useSettingsStore();
const terminalsStore = useTerminalsStore();
const deps: TerminalHostDeps = {
  rendererDeps: {
    appearance: () => settingsStore.appearance,
    onTerminalOutput: terminalsStore.onTerminalOutput,
    writeTerminal: terminalsStore.writeTerminal,
  },
  terminalSession: terminalsStore.terminalSession,
  openTerminalSession: terminalsStore.openTerminalSession,
  resizeTerminal: terminalsStore.resizeTerminal,
};

// P86 §9.4: discoverability for hooks reporting, without a write anywhere until the user actually
// clicks Enable. Shown while this tab is a Claude Code launch, hooks are off, and the prompt was
// never dismissed; hooksJustEnabled keeps the banner in place with a different line for the rest
// of this tab's life once Enable is clicked — settingsStore.claudeCode.hooksEnabled flipping true
// would otherwise make showHooksPrompt false and the banner vanish outright.
const hooksJustEnabled = ref(false);

const showHooksPrompt = computed(
  () =>
    props.tab.state.launchKind === 'claude-code' &&
    !settingsStore.claudeCode.hooksPromptDismissed &&
    (hooksJustEnabled.value || !settingsStore.claudeCode.hooksEnabled),
);

// Never types into the PTY (P83 §8.2, P85 §3.1) — the running session is not restarted and not
// touched; the flag change applies to the next Claude Code tab opened.
async function onEnableHooksPrompt(): Promise<void> {
  await useAgentHooksStore().setAgentHooksEnabled(true);
  hooksJustEnabled.value = true;
}

async function onDismissHooksPrompt(): Promise<void> {
  await settingsStore.patchSettings({ claudeCode: { hooksPromptDismissed: true } });
}
</script>

<template>
  <TerminalHostView :tab="tab" :deps="deps">
    <div
      v-if="showHooksPrompt"
      class="claude-code-hooks-prompt"
      data-testid="claude-code-hooks-prompt"
    >
      <span v-if="hooksJustEnabled">
        Session reporting is on. It applies to the next Claude Code tab you open.
      </span>
      <template v-else>
        <span>
          Kira Studio can show what this session is doing — a running-session count and a tab dot
          when it needs your attention.
        </span>
        <button type="button" class="p-btn primary" @click="onEnableHooksPrompt">Enable</button>
        <button type="button" class="p-btn" @click="onDismissHooksPrompt">Not now</button>
      </template>
    </div>
  </TerminalHostView>
</template>

<style scoped>
@reference "@theme/base.css";

.claude-code-hooks-prompt {
  @apply flex items-center shrink-0 rounded-kira-sm bg-chrome text-muted-foreground text-kira-sm gap-1.5 mb-1 py-1 px-1.5;
}
.claude-code-hooks-prompt span {
  @apply flex-1;
}
</style>
