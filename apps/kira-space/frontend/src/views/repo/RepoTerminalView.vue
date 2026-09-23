<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component
// (MainView.vue keeps only RepoGraphView alive) but must lose nothing; TerminalHostView owns the
// mount-into-container lifecycle (never calls term.open() twice).
//
// P107 I2-19: this used to be a full duplicate of Kira Studio's own TerminalView.vue — now both
// wrap @workbench/terminal/TerminalHostView.vue, which owns the template/style/composable call
// genuinely identical between them. This file's own remaining job: build `deps` from this app's
// stores. Kira Studio's own Claude Code session-reporting banner (P86 §9.4, passed there as
// TerminalHostView's default slot) is dropped here, not ported: this app's own TerminalService has
// no AgentHooks integration (bridge/terminal.go's own doc comment — a plain `claude` launch, no
// `--settings` flag, no hook env, no status-bar session count), and model.Settings carries no
// `claudeCode` leaf to back a dismiss/enable toggle with. A `claude-code` LaunchKind still runs (it
// is still a valid wire value, still just a shell command), it simply never gets Studio's own hook
// plumbing.
import TerminalHostView, { type TerminalHostDeps } from '@workbench/terminal/TerminalHostView.vue';
import { useSettingsStore } from '../../state/settings';
import type { TerminalTabRecord } from '../../state/tabDomain';
import { useTerminalsStore } from '../../state/terminals';

defineProps<{ tab: TerminalTabRecord }>();
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
</script>

<template>
  <TerminalHostView :tab="tab" :deps="deps" />
</template>
