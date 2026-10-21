<script setup lang="ts">
import AdeActivityIcon from '../AdeActivityIcon.vue';
import AdeSessionId from './AdeSessionId.vue';
import type { SessionView } from './sessionView';

// Shared status bar of a session pane: activity glyph, pane-specific content, Claude session id.
defineProps<{ view: SessionView; needsYou: boolean }>();
</script>

<template>
  <div
    class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-kira-md"
    :class="needsYou ? 'bg-tone-amber-solid/8 text-tone-amber' : 'text-muted-foreground'"
  >
    <AdeActivityIcon :kind="view.kind" :size="14" />
    <slot />
    <AdeSessionId class="ml-auto" :id="view.session.agentSessionId" />
  </div>
</template>
