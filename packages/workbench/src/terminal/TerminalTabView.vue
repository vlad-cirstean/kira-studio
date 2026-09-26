<script setup lang="ts">
import { useTerminalModule } from './module';
// P128 §2.5: the one shared terminal tab view — Kira Studio's own views/terminal/TerminalView.vue
// and Kira Space's own views/repo/RepoTerminalView.vue were byte-identical bar comments (both
// already wrapped TerminalHostView.vue, P107 I2-19); this replaces both. A repo terminal and a
// module terminal are the same tab kind, differing only in workspaceId/codeRepoId — set by whichever
// opener built the tab (state/repoTabs.ts's openRepoTerminalTab stays in the git module; the
// terminal module's own opener goes through useNewTerminal/TerminalNewTab.vue). `tab` is typed
// against TerminalHostView's own prop shape, not either app's own TerminalTabRecord (which differs
// per app only in fields this view never reads).
import TerminalHostView, { type TerminalHostTabState } from './TerminalHostView.vue';

defineProps<{ tab: { id: string; state: TerminalHostTabState } }>();
const ctx = useTerminalModule();
</script>

<template>
  <TerminalHostView :tab="tab" :deps="ctx.host" />
</template>
