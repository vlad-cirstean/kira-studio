<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { computed } from 'vue';
import { useBlameStatusStore } from '../state/blameStatus';
import { blameLineText, blameLineTooltip } from '../views/repo/blameLine';

// P100 Part 2: Kira Studio's own workbench/StatusBar.vue, trimmed to LAW 14's own left "caret
// status" slot plus the blame item (P76 §5.2, still real here — useInlineBlame.ts/blameStatus.ts
// both ported verbatim, RepoFileView.vue's own inline-blame feature needs somewhere to publish
// its status-bar readout). Everything else on the right side is dropped:
//   - no AgentSessions store (no Claude Code hook integration, main.ts's own doc comment)
//   - no AppMetrics store (no adapterhost/metrics ticker — no database connections to sample)
//   - no AppUpdate store (this app has no UpdateService — apps/kira-space/main.go's own Services
//     list)
//   - no CacheStats store (no query-result cache — this app has no query console)
//   - no EngineService/EngineStore (kira-space's own bundled-engine health check has no
//     counterpart here)
// The caret-status slot itself: not yet wired per-view (no per-editor caret tracking built yet),
// so "no selection" is the honest default rather than a placeholder number, same as Studio's own.
const blameStatusStore = useBlameStatusStore();

// P76 §5.2: 'none' and 'uncommitted' both render nothing — an always-present "Uncommitted" readout
// is the extension's own choice; this bar hides items with nothing to say instead.
const blame = computed(() =>
  blameStatusStore.status.kind === 'resolved' ? blameStatusStore.status : null,
);
const blameText = computed(() => (blame.value ? blameLineText(blame.value) : ''));
const blameTooltip = computed(() => (blame.value ? blameLineTooltip(blame.value).join(' — ') : ''));

function onRevealBlameCommit(): void {
  if (blame.value) blameStatusStore.reveal?.(blame.value.sha);
}
</script>

<template>
  <div class="p-statusbar" :style="{ color: 'var(--kira-fg-muted)' }">
    <div class="side">
      <span class="p-status" data-testid="caret-status">
        <span class="mono xs muted">no selection</span>
      </span>
      <!-- P76 §5.2: a sibling fact, not the caret-status slot above — that readout stays unwired. -->
      <button
        v-if="blame"
        class="p-status blame"
        data-testid="blame-status"
        :disabled="!blameStatusStore.reveal"
        v-tooltip="blameTooltip"
        @click="onRevealBlameCommit"
      >
        <CodiconIcon name="git-commit" :size="13" />
        <span class="blame-text">{{ blameText }}</span>
      </button>
    </div>
    <div class="side" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* .blame is a <button> so keyboard focus/Enter/Space come free; its UA chrome reset mirrors
   .p-status. No accent color — a blame readout is informational, not something needing attention. */
.blame {
  @apply bg-none;
  font: inherit;
  color: var(--kira-fg);
}
.blame:disabled {
  @apply cursor-default;
}
.blame-text {
  @apply max-w-[48ch] overflow-hidden text-ellipsis whitespace-nowrap;
}
</style>
