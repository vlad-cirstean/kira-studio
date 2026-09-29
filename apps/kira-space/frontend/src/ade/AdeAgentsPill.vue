<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { formatTimeAgo } from '@vueuse/core';
import AdeActivityGlyph from './AdeActivityGlyph.vue';
import { ACTIVITY_LABEL } from './activity';
import { adeAgoOptions } from './ago';
import { activityTextColor } from './tones';
import type { QueueItem } from './useQueue';

// P129 Part 5 §0.18: the mockup's own running-sessions capsule (mockup 233-247) — the robot icon is
// the standing generic-icon decision (Part 1 §0), never the branded asset. P129 Part 6 §0.21: a
// click opens that agent's own session in the Agents tab (select the item, switch tab, pick its
// terminal), threaded up through `AdeStackRow`/`AdeStackBlock`/`AdeDayBand`/`AdeTimeline` to
// `AdeRepoView`, whose handler calls `adeUi.openSession`.
const props = defineProps<{ itemId: string; agents: QueueItem['agents'] }>();

const emit = defineEmits<{ openSession: [itemId: string, sessionId: string] }>();

function lastActive(ms: number): string {
  return formatTimeAgo(new Date(ms), adeAgoOptions);
}
</script>

<template>
  <span
    v-if="agents.length > 0"
    title="Claude Code sessions"
    class="inline-flex h-[22px] shrink-0 items-center gap-[3px] rounded-full border border-border-strong bg-chrome py-0 pl-1 pr-[5px]"
    data-testid="ade-agents-pill"
  >
    <CodiconIcon name="robot" :size="11" class="mr-px text-primary" />
    <Tooltip v-for="agent in agents" :key="agent.sessionId" :delay-duration="0">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex size-4 items-center justify-center rounded"
          :aria-label="`Open claude ${agent.sessionId}`"
          :data-testid="`ade-agent-${agent.sessionId}`"
          @click="emit('openSession', props.itemId, agent.sessionId)"
        >
          <AdeActivityGlyph :kind="agent.kind" :size="13" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="flex flex-col gap-px">
        <span class="font-data text-kira-sm">{{ agent.label }}</span>
        <span class="text-kira-sm">
          <span :style="{ color: activityTextColor(agent.kind) }">{{ ACTIVITY_LABEL[agent.kind] }}</span>
          <span class="text-muted-foreground"> · {{ lastActive(agent.lastActiveAt) }}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  </span>
</template>
