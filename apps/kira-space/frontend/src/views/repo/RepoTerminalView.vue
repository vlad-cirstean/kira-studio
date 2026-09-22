<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component
// (MainView.vue keeps only RepoGraphView alive) but must lose nothing, so mount only moves an
// already-live DOM subtree into this component's own container; it never calls term.open() twice.
import type { TerminalTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSettingsStore } from '../../state/settings';
import { useTerminalsStore } from '../../state/terminals';
import { loadTerminalRenderer } from './terminalRendererLoader';

const props = defineProps<{ tab: TerminalTabRecord }>();
const settingsStore = useSettingsStore();
const terminalsStore = useTerminalsStore();

const container = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let renderer: typeof import('./terminalRenderer') | null = null;

const session = computed(() => terminalsStore.terminalSession(props.tab.id));
const footerText = computed(() => {
  const s = session.value;
  if (!s) return '';
  if (s.status === 'failed') return s.error || 'The terminal could not start.';
  if (s.status === 'exited') return `Process exited (code ${s.exitCode ?? 0})`;
  return '';
});

async function mount(): Promise<void> {
  const mod = await loadTerminalRenderer();
  // Unmounted (tab closed/switched away) while the import above was in flight.
  if (!container.value) return;
  renderer = mod;

  const { host } = mod.getOrCreateTerminal(props.tab.id);
  container.value.appendChild(host);

  // §7.3/§7.4: openTerminalSession only on the tab's very first mount — a remount (switching back
  // to an already-open terminal) reattaches the same live session, never spawns a second one.
  const isFirstOpen = !terminalsStore.terminalSession(props.tab.id);
  const dims = mod.fitTerminal(props.tab.id) ?? { cols: 80, rows: 24 };
  if (isFirstOpen) {
    void terminalsStore.openTerminalSession(
      props.tab.id,
      props.tab.state.codeRepoId,
      props.tab.state.cwd,
      dims.cols,
      dims.rows,
      props.tab.state.command,
      props.tab.state.launchKind,
    );
  }

  // No debounce needed — a ResizeObserver callback already coalesces synchronous layout thrash
  // into one notification per frame (SlickGridHost.vue's own precedent).
  // P99 §9.3: not useResizeObserver — this construction sits after `await loadTerminalRenderer()`
  // above, past the point Vue's synchronous "current instance" tracking a composable's automatic
  // onUnmounted registration relies on; moving it earlier would mean guarding every callback
  // invocation against `renderer` still being null, a real behavior change for a mechanical
  // conversion. Declined, named per CLAUDE.md's library rule.
  resizeObserver = new ResizeObserver(() => {
    const d = mod.fitTerminal(props.tab.id);
    if (d) terminalsStore.resizeTerminal(props.tab.id, d.cols, d.rows);
  });
  resizeObserver.observe(container.value);
}

onMounted(() => void mount());

// A mere tab switch away: the ResizeObserver stops (nothing to measure while hidden), and the
// host detaches with its parent — the live Terminal and its Go-side pty both survive (§6.2/§6.3).
// Only dropResources (a real close, state/tabKinds.ts's terminal entry) tears them down.
onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

// §6.3: the Appearance "Data font" setting is read live, not only at mount — a change while this
// terminal is open re-applies immediately, the same live-apply RepoFileView.vue's own wordWrap
// already gets.
watch(
  () => [settingsStore.appearance.fontFamily, settingsStore.appearance.fontSize] as const,
  () => {
    const d = renderer?.applyTerminalAppearance(props.tab.id);
    if (d) terminalsStore.resizeTerminal(props.tab.id, d.cols, d.rows);
  },
);

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
@reference "@/theme/base.css";

.repo-terminal {
  @apply flex flex-col h-full bg-bg p-[var(--kira-s-2)];
}
.terminal-host {
  @apply flex-1 min-h-0;
}
.terminal-footer {
  @apply shrink-0 text-muted text-[length:var(--kira-t-sm)] bg-[var(--kira-bg-chrome)] py-[var(--kira-s-1)] px-[var(--kira-s-2)];
}
.terminal-footer-error {
  @apply text-error;
}
</style>
