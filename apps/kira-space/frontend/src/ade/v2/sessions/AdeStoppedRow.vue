<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { ref } from 'vue';
import { adeAgoOptions } from '../ago';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import type { SessionView } from './sessionView';

const props = defineProps<{ view: SessionView; archived?: boolean }>();

const takeOver = useAdeTakeOverStore();
const ago = useTimeAgo(() => props.view.session.lastActiveAt, adeAgoOptions);
const open = ref(false);
</script>

<template>
  <div class="flex items-center gap-2 text-kira-md" data-testid="ade-stopped-row" :data-session-id="view.session.id">
    <span class="size-1.5 shrink-0 rounded-[1px] bg-disabled" />
    <span class="w-16 shrink-0 text-kira-sm text-muted-foreground">{{ ago }}</span>
    <Button
      v-if="!archived"
      variant="dialog"
      size="xs"
      class="shrink-0 px-2"
      :disabled="takeOver.pending.has(view.session.id)"
      data-testid="ade-stopped-takeover"
      @click="takeOver.request(view.session.id)"
    >
      Take over
    </Button>
    <button
      v-if="view.headless && view.session.runId"
      type="button"
      class="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-data text-kira-sm text-fg underline decoration-dotted"
      data-testid="ade-stopped-log-toggle"
      @click="open = !open"
    >
      {{ view.stoppedLabel }}
    </button>
    <span v-else class="min-w-0 truncate font-data text-kira-sm">{{ view.stoppedLabel }}</span>
  </div>
  <AdeRunLog v-if="open" kind="run" :id="view.session.runId" max-height="140px" />
</template>
