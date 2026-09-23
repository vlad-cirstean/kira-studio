<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component
// (MainView.vue keeps only RepoGraphView alive) but must lose nothing, so mount only moves an
// already-live DOM subtree into this component's own container; it never calls term.open() twice.
import type { TerminalRendererDeps } from '@workbench/terminal/terminalRenderer';
import { useTerminalMount } from '@workbench/terminal/useTerminalMount';
import { ref } from 'vue';
import { useSettingsStore } from '../../state/settings';
import type { TerminalTabRecord } from '../../state/tabDomain';
import { useTerminalsStore } from '../../state/terminals';

const props = defineProps<{ tab: TerminalTabRecord }>();
const settingsStore = useSettingsStore();
const terminalsStore = useTerminalsStore();
// P103 Part 1: terminalRenderer.ts hoisted to @workbench/terminal — it has no package-boundary
// way to reach this app's own settings/terminals stores directly any more, so the two it needs are
// passed in here instead (§4.3's own deps seam).
const rendererDeps: TerminalRendererDeps = {
  appearance: () => settingsStore.appearance,
  onTerminalOutput: terminalsStore.onTerminalOutput,
  writeTerminal: terminalsStore.writeTerminal,
};

// P107 T2-21: mount/resize/appearance-watch/unmount lifecycle shared with Kira Studio's own
// TerminalView.vue via packages/workbench/src/terminal/useTerminalMount.ts.
const container = ref<HTMLElement | null>(null);
const { session, footerText } = useTerminalMount({
  tabId: props.tab.id,
  tabState: props.tab.state,
  container,
  rendererDeps,
  terminalSession: terminalsStore.terminalSession,
  openTerminalSession: terminalsStore.openTerminalSession,
  resizeTerminal: terminalsStore.resizeTerminal,
});

// P100 Part 2: Kira Studio's own Claude Code session-reporting banner (P86 §9.4 — the
// hooksJustEnabled/showHooksPrompt/onEnableHooksPrompt/onDismissHooksPrompt block, and the
// useAgentHooksStore/settingsStore.claudeCode dependencies it needed) is dropped here, not
// ported: this app's own TerminalService has no AgentHooks integration (bridge/terminal.go's own
// doc comment — a plain `claude` launch, no `--settings` flag, no hook env, no status-bar
// session count), and model.Settings carries no `claudeCode` leaf to back a dismiss/enable toggle
// with. A `claude-code` LaunchKind still runs (it is still a valid wire value, still just a shell
// command), it simply never gets Studio's own hook plumbing.
</script>

<template>
  <div class="repo-terminal">
    <div ref="container" class="terminal-host" data-testid="repo-terminal-host" />
    <div
      v-if="session && (session.status === 'exited' || session.status === 'failed')"
      class="terminal-footer"
      :class="{ 'terminal-footer-error': session.status === 'failed' }"
      data-testid="repo-terminal-footer"
    >
      {{ footerText }}
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.repo-terminal {
  @apply flex flex-col h-full bg-bg p-1;
}
.terminal-host {
  @apply flex-1 min-h-0;
}
.terminal-footer {
  @apply shrink-0 text-muted text-kira-sm bg-chrome py-0.5 px-1;
}
.terminal-footer-error {
  @apply text-error;
}
</style>
