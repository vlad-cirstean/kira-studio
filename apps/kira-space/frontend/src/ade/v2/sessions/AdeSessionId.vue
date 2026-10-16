<script setup lang="ts">
import { t } from '@theme/i18n';
import Identifier from '@workbench/components/Identifier.vue';

// The Claude session id of a session, full and copyable, for `claude --resume <id>`.
defineProps<{ id: string }>();
</script>

<template>
  <span class="flex min-w-0 items-center gap-1 text-kira-sm" data-testid="ade-session-id">
    <Identifier v-if="id" :value="id" copyable />
    <span v-else class="text-subtle">{{ t('space.ade.sessionList.waitingId.status') }}</span>
  </span>
</template>
