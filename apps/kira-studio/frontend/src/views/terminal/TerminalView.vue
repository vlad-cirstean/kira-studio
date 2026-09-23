<script setup lang="ts">
// P83 §6.2/§6.3: the terminal tab view. The live xterm Terminal (and its Go-side pty) live in
// terminalRenderer.ts's own module-level map, not here — a tab switch unmounts this component but
// must lose nothing, so mount only moves an already-live DOM subtree into this component's own
// container; it never calls term.open() twice.
//
// P100 Part 2: this file (plus terminalRenderer.ts/terminalRendererLoader.ts alongside it) used to
// live in views/repo/ and render both a repo-worktree terminal and this app's own standalone
// Terminal-module terminal (workbench/tabViews.ts's TAB_VIEWS['terminal'], the same TabKind either
// way) — genuinely dual-owned, not repo-specific at all despite the old directory name (no repo
// concept appears anywhere in this component). The repo workspace moved to apps/kira-space
// wholesale, but this app's own standalone Terminal module still needs a 'terminal'-kind renderer,
// so this is now a duplicate, not an import: the two frontends are separate Vite apps with no
// shared package boundary (@shared/domain/tabs.ts's own TabKind vocabulary keeps 'terminal' for
// both). Same "duplicate, don't hoist" call as the Monaco bootstrap (editor/monaco.ts's own doc
// comment) and Go's internal/terminal package — see this phase's own result section. Kira Space's
// own copy (apps/kira-space/frontend/src/views/repo/RepoTerminalView.vue) drops the Claude Code
// hooks banner below (its own TerminalService has no AgentHooks integration); this copy, staying
// in Kira Studio, keeps it unchanged.
import type { TerminalRendererDeps } from '@workbench/terminal/terminalRenderer';
import { useTerminalMount } from '@workbench/terminal/useTerminalMount';
import { computed, ref } from 'vue';
import { useAgentHooksStore } from '../../state/agentHooks';
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

// P107 T2-21: mount/resize/appearance-watch/unmount lifecycle shared with Kira Space's own
// RepoTerminalView.vue via packages/workbench/src/terminal/useTerminalMount.ts.
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
.claude-code-hooks-prompt {
  @apply flex items-center shrink-0 rounded-kira-sm bg-chrome text-muted text-kira-sm gap-1.5 mb-1 py-1 px-1.5;
}
.claude-code-hooks-prompt span {
  @apply flex-1;
}
</style>
