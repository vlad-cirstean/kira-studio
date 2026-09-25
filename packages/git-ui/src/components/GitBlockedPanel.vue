<script setup lang="ts">
/**
 * §4.2's block state: git too old, not found, or unusable. Nothing else in the UI renders while
 * this holds — "the app does not start into a degraded mode" — so `App.vue` (W11) shows this in
 * place of the toolbar and list entirely, not layered over them.
 */
import type { GitStatus } from '@kira/git-ipc';
import { computed } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import { type BlockedGitStatus, detectPlatform, gitBlockedCopy } from './gitBlockedCopy.ts';

const props = defineProps<{ status: GitStatus }>();

const copy = computed(() => {
  if (props.status.kind === 'ok') return null;
  return gitBlockedCopy(props.status as BlockedGitStatus, detectPlatform(navigator.userAgent));
});
</script>

<template>
  <div
    v-if="copy"
    class="kv:flex kv:flex-col kv:items-center kv:justify-center kv:gap-2 kv:h-full kv:p-4 kv:text-center kv:text-fg"
    role="alert"
    data-testid="git-blocked-panel"
  >
    <span
      class="codicon kv:text-[32px] kv:text-error"
      :class="STATE_ICONS.warning"
      aria-hidden="true"
    ></span>
    <h2 class="kv:m-0 kv:text-lg kv:font-semibold">{{ copy.title }}</h2>
    <p class="kv:m-0 kv:max-w-120 kv:text-muted-foreground">{{ copy.detail }}</p>
  </div>
</template>
