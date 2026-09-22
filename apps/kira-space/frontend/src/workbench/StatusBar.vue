<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import { computed } from 'vue';
import { useBlameStatusStore } from '../state/blameStatus';
import { blameLineText, blameLineTooltip } from '../views/repo/blameLine';

// P103 Part 2 (§5.4): Kira Studio's own workbench/StatusBar.vue, trimmed to the blame item (P76
// §5.2) beside the shared caret-status slot. Now a thin composition over the shared bar chrome
// (packages/workbench/src/components/StatusBar.vue).
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
  <StatusBarBase>
    <template #left-extra>
      <!-- P76 §5.2: a sibling fact, not the caret-status slot — that readout stays unwired. -->
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
    </template>
  </StatusBarBase>
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
