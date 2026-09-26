<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component but
// must lose nothing; TerminalHostView owns the mount-into-container lifecycle (never calls
// term.open() twice).
//
// P100 Part 2 / P107 I2-19: this used to be a full duplicate of Kira Space's own
// RepoTerminalView.vue (two Vite apps, no shared package boundary for a whole component) — now
// both wrap @workbench/terminal/TerminalHostView.vue, which owns the template/style/composable
// call genuinely identical between them. P127: this file used to also carry a Claude Code hooks
// banner as TerminalHostView's default slot (agent-activity monitoring left Kira Studio); with it
// gone, this file's own remaining job is building `deps` from this app's stores — no remaining
// difference from Kira Space's own wrapper.
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
