<script lang="ts">
// Module scope (not <script setup>, which re-runs per instance) — mirrors editor/monaco.ts's own
// loadMonaco: memoized so repeated mounts (a tab switched back to) don't reissue the import, reset
// on failure so one transient error doesn't permanently break every terminal opened afterward in
// this session.
let terminalRendererPromise: Promise<typeof import('./terminalRenderer')> | null = null;

function loadTerminalRenderer(): Promise<typeof import('./terminalRenderer')> {
  if (!terminalRendererPromise) {
    terminalRendererPromise = import('./terminalRenderer').catch((err) => {
      terminalRendererPromise = null;
      throw err;
    });
  }
  return terminalRendererPromise;
}
</script>

<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component
// (MainView.vue keeps only RepoGraphView alive) but must lose nothing, so mount only moves an
// already-live DOM subtree into this component's own container; it never calls term.open() twice.
import type { TerminalTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { settingsState } from '../../state/settings';
import { openTerminalSession, resizeTerminal, terminalSession } from '../../state/terminals';

const props = defineProps<{ tab: TerminalTabRecord }>();

const container = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let renderer: typeof import('./terminalRenderer') | null = null;

const session = computed(() => terminalSession(props.tab.id));
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
  const isFirstOpen = !terminalSession(props.tab.id);
  const dims = mod.fitTerminal(props.tab.id) ?? { cols: 80, rows: 24 };
  if (isFirstOpen) {
    void openTerminalSession(
      props.tab.id,
      props.tab.state.codeRepoId,
      props.tab.state.cwd,
      dims.cols,
      dims.rows,
      props.tab.state.command,
    );
  }

  // No debounce needed — a ResizeObserver callback already coalesces synchronous layout thrash
  // into one notification per frame (SlickGridHost.vue's own precedent).
  resizeObserver = new ResizeObserver(() => {
    const d = mod.fitTerminal(props.tab.id);
    if (d) resizeTerminal(props.tab.id, d.cols, d.rows);
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
  () => [settingsState.appearance.fontFamily, settingsState.appearance.fontSize] as const,
  () => {
    const d = renderer?.applyTerminalAppearance(props.tab.id);
    if (d) resizeTerminal(props.tab.id, d.cols, d.rows);
  },
);
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
.repo-terminal {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kira-bg);
  padding: var(--kira-s-2);
}
.terminal-host {
  flex: 1;
  min-height: 0;
}
.terminal-footer {
  flex-shrink: 0;
  padding: var(--kira-s-1) var(--kira-s-2);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
  background: var(--kira-bg-chrome);
}
.terminal-footer-error {
  color: var(--kira-error);
}
</style>
