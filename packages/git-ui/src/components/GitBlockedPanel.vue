<script setup lang="ts">
/**
 * §4.2's block state: git too old, not found, or unusable. Nothing else in the UI renders while
 * this holds — "the app does not start into a degraded mode" — so `App.vue` (W11) shows this in
 * place of the toolbar and list entirely, not layered over them.
 */
import type { GitStatus } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import { computed } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import { type BlockedGitStatus, detectPlatform, gitBlockedCopy } from '../lib/gitBlockedCopy.ts';

const props = defineProps<{ status: GitStatus }>();

const copy = computed(() => {
  if (props.status.kind === 'ok') return null;
  return gitBlockedCopy(props.status as BlockedGitStatus, detectPlatform(navigator.userAgent));
});
</script>

<template>
  <EmptyState
    v-if="copy"
    class="h-full p-6"
    role="alert"
    data-testid="git-blocked-panel"
    :title="copy.title"
    :description="copy.detail"
  >
    <template #media
      ><CodiconIcon :name="STATE_ICONS.warning" :size="24" class="text-error" /></template
    >
  </EmptyState>
</template>
