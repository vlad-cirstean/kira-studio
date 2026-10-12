<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { useRelativeTime } from '@workbench/behaviour/format';
import { ref } from 'vue';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import type { SessionView } from './sessionView';

const props = defineProps<{ view: SessionView; archived?: boolean }>();

const takeOver = useAdeTakeOverStore();
const ago = useRelativeTime(() => props.view.session.lastActiveAt);
const open = ref(false);
</script>

<template>
  <div
    class="flex items-center gap-2 text-kira-md"
    data-testid="ade-stopped-row"
    :data-session-id="view.session.id"
  >
    <span class="size-1.5 shrink-0 rounded-kira-xs bg-disabled" />
    <span class="w-16 shrink-0 text-kira-sm text-muted-foreground">{{ ago }}</span>
    <Button
      v-if="!archived"
      variant="dialog"
      size="kira"
      class="shrink-0"
      :pending="takeOver.pending.has(view.session.id)"
      data-testid="ade-stopped-takeover"
      @click="takeOver.request(view.session.id)"
    >
      {{ t('common.action.takeOver.label') }}
    </Button>
    <Button
      v-if="view.headless && view.session.runId"
      variant="link"
      size="inline"
      class="min-w-0 justify-start truncate text-kira-sm text-fg"
      data-testid="ade-stopped-log-toggle"
      @click="open = !open"
    >
      {{ view.stoppedLabel }}
    </Button>
    <span v-else class="min-w-0 truncate text-kira-sm">{{ view.stoppedLabel }}</span>
  </div>
  <AdeRunLog v-if="open" kind="run" :id="view.session.runId" max-height="140px" />
</template>
