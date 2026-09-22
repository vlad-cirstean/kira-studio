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
.claude-code-hooks-prompt {
  @apply flex items-center shrink-0 rounded-kira-sm bg-[var(--kira-bg-chrome)] text-muted text-[length:var(--kira-t-sm)] gap-[var(--kira-s-3)] mb-[var(--kira-s-2)] py-[var(--kira-s-2)] px-[var(--kira-s-3)];
}
.claude-code-hooks-prompt span {
  @apply flex-1;
}
</style>
