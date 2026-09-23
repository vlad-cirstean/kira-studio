<script setup lang="ts">
// P107 I2-19: TerminalView.vue (Kira Studio) and RepoTerminalView.vue (Kira Space) stayed
// line-identical past T2-21's own useTerminalMount extraction — the rendererDeps object, the
// composable call, the container/footer template and its scoped style. This owns that remainder;
// each app's own view is now a thin wrapper passing its stores as `deps` and, for Kira Studio's
// Claude Code hooks banner (the one real difference — Kira Space's TerminalService has no
// AgentHooks integration), a default slot rendered before the terminal host.
import type { TerminalTabState } from '@shared/domain/tabs';
import { ref } from 'vue';
import type { TerminalRendererDeps } from './terminalRenderer';
import { type TerminalMountSession, useTerminalMount } from './useTerminalMount';

export type TerminalHostTabState = Pick<
  TerminalTabState,
  'codeRepoId' | 'cwd' | 'command' | 'launchKind'
>;

export interface TerminalHostDeps {
  rendererDeps: TerminalRendererDeps;
  terminalSession: (tabId: string) => TerminalMountSession | undefined;
  openTerminalSession: (
    tabId: string,
    codeRepoId: string,
    cwd: string,
    cols: number,
    rows: number,
    command: string,
    launchKind: TerminalHostTabState['launchKind'],
  ) => Promise<void>;
  resizeTerminal: (tabId: string, cols: number, rows: number) => void;
}

const props = defineProps<{
  tab: { id: string; state: TerminalHostTabState };
  deps: TerminalHostDeps;
}>();

const container = ref<HTMLElement | null>(null);
const { session, footerText } = useTerminalMount({
  tabId: props.tab.id,
  tabState: props.tab.state,
  container,
  rendererDeps: props.deps.rendererDeps,
  terminalSession: props.deps.terminalSession,
  openTerminalSession: props.deps.openTerminalSession,
  resizeTerminal: props.deps.resizeTerminal,
});
</script>

<template>
  <div class="repo-terminal">
    <slot />
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
