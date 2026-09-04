<script setup lang="ts">
/**
 * §4.2's block state: git too old, not found, or unusable. Nothing else in the UI renders while
 * this holds — "the app does not start into a degraded mode" — so `App.vue` (W11) shows this in
 * place of the toolbar and list entirely, not layered over them.
 */
import type { GitStatus } from '@kira/git-ipc';
import { computed } from 'vue';
import { STATE_ICONS } from '../icons/index';
import { type BlockedGitStatus, detectPlatform, gitBlockedCopy } from './gitBlockedCopy';

const props = defineProps<{ status: GitStatus }>();

const copy = computed(() => {
  if (props.status.kind === 'ok') return null;
  return gitBlockedCopy(props.status as BlockedGitStatus, detectPlatform(navigator.userAgent));
});
</script>

<template>
  <div v-if="copy" class="kv-blocked-panel" role="alert" data-testid="git-blocked-panel">
    <span class="codicon kv-blocked-icon" :class="STATE_ICONS.warning" aria-hidden="true"></span>
    <h2 class="kv-blocked-title">{{ copy.title }}</h2>
    <p class="kv-blocked-detail">{{ copy.detail }}</p>
  </div>
</template>

<style>
.kv-blocked-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kv-space-3);
  height: 100%;
  padding: var(--kv-space-5);
  text-align: center;
  color: var(--kv-app-fg);
}

.kv-blocked-icon {
  font-size: 32px;
  color: var(--kv-error-fg);
}

.kv-blocked-title {
  margin: 0;
  font-size: 1.1em;
  font-weight: 600;
}

.kv-blocked-detail {
  margin: 0;
  max-width: 480px;
  color: var(--kv-description-fg);
}
</style>
