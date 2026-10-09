<script setup lang="ts">
// P107 I2-19: TerminalView.vue (Kira Studio) and RepoTerminalView.vue (Kira Space) stayed
// line-identical past T2-21's own useTerminalMount extraction — the rendererDeps object, the
// composable call, the container/footer template and its scoped style. This owns that remainder;
// each app's own view is now a thin wrapper passing its stores as `deps` and, for Kira Studio's
// Claude Code hooks banner (the one real difference — Kira Space's TerminalService has no
// AgentHooks integration), a default slot rendered before the terminal host.
// P128 §2.4: TerminalHostTabState/TerminalHostDeps moved to terminalHost.ts (a plain .ts file
// module.ts, also non-.vue, can import types from) — re-exported here so existing `.vue`
// consumers of `./TerminalHostView.vue` keep working unchanged.
import { ref } from 'vue';
import type { TerminalHostDeps, TerminalHostTabState } from './terminalHost';
import { useTerminalMount } from './useTerminalMount';

export type { TerminalHostDeps, TerminalHostTabState } from './terminalHost';

const props = defineProps<{
  tab: { id: string; state: TerminalHostTabState };
  deps: TerminalHostDeps;
  /** A caller-supplied result block (the "outcome" slot) replaces the plain exit footer. */
  hideFooter?: boolean;
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
  <div class="flex flex-col h-full bg-bg p-1">
    <slot />
    <div ref="container" class="flex-1 min-h-0" data-testid="repo-terminal-host" />
    <slot name="outcome" />
    <div
      v-if="!hideFooter && session && (session.status === 'exited' || session.status === 'failed')"
      class="shrink-0 text-kira-sm bg-chrome py-0.5 px-1"
      :class="session.status === 'failed' ? 'text-error' : 'text-muted-foreground'"
      data-testid="repo-terminal-footer"
    >
      {{ footerText }}
    </div>
  </div>
</template>
