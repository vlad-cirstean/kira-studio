<script lang="ts">
// Module scope (not <script setup>, which re-runs per instance) — mirrors editor/monaco.ts's own
// loadMonaco: memoized so repeated mounts (a tab switched back to) don't reissue the import, reset
// on failure so one transient error doesn't permanently break every terminal opened afterward in
// this session.
let terminalRendererPromise: Promise<typeof import('./terminalRenderer')> | null = null;

// biome-ignore lint/correctness/noUnusedVariables: called from the <script setup> block below — Biome's Vue support does not link scope across a plain <script> and <script setup> block in one SFC.
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
import { useAgentHooksStore } from '../../state/agentHooks';
import { useSettingsStore } from '../../state/settings';
import { useTerminalsStore } from '../../state/terminals';

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
  <div class="repo-terminal">
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
.claude-code-hooks-prompt {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  flex-shrink: 0;
  margin-bottom: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-chrome);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
}
.claude-code-hooks-prompt span {
  flex: 1;
}
</style>
