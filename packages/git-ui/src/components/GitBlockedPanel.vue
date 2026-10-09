<script setup lang="ts">
/**
 * §4.2's block state: git too old, not found, or unusable. Nothing else in the UI renders while
 * this holds — "the app does not start into a degraded mode" — so `App.vue` (W11) shows this in
 * place of the toolbar and list entirely, not layered over them.
 */
import type { GitStatus, HostKind } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { computed } from 'vue';
import { codiconName, STATE_ICONS } from '../icons/index.ts';
import { type BlockedGitStatus, detectPlatform, gitBlockedCopy } from './gitBlockedCopy.ts';

const props = defineProps<{ status: GitStatus; host: HostKind }>();

const copy = computed(() => {
  if (props.status.kind === 'ok') return null;
  return gitBlockedCopy(
    props.status as BlockedGitStatus,
    detectPlatform(navigator.userAgent),
    props.host,
  );
});
</script>

<template>
  <Empty v-if="copy" class="h-full p-6" role="alert" data-testid="git-blocked-panel">
    <EmptyMedia variant="icon">
      <CodiconIcon :name="codiconName(STATE_ICONS.warning)" :size="24" class="text-error" />
    </EmptyMedia>
    <EmptyTitle class="font-semibold text-fg">{{ copy.title }}</EmptyTitle>
    <EmptyDescription class="max-w-120">{{ copy.detail }}</EmptyDescription>
  </Empty>
</template>
