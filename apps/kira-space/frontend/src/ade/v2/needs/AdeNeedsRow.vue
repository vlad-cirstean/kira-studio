<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { shortAge } from '../ago';
import type { NeedsItem } from '../board/needsYou';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { actionStyle, solidStyle, TONE, tagStyle } from '../tones';
import { useNeedsAction } from './useNeedsAction';

// One needs-you item (mockup `needs`): kind chip, age, its one action, scope, what, over the task.
const props = defineProps<{ item: NeedsItem; taskTitle: string; taskColor: string }>();

const { perform, busy } = useNeedsAction();
const logOpen = ref(false);
const hasLog = computed(
  () => (props.item.kind === 'stuck run' || props.item.kind === 'failed') && props.item.runIds.length > 0,
);
const buttonStyle = computed(() => {
  if (props.item.action === 'Take over') return actionStyle('claude');
  return props.item.tone === 'grey'
    ? { background: 'var(--kira-border-strong)', color: 'var(--kira-fg)' }
    : solidStyle(props.item.tone);
});
const rowBackground = computed(() => {
  if (props.item.tone === 'grey') return 'var(--kira-bg-elevated)';
  return `color-mix(in srgb, ${TONE[props.item.tone][2]} ${props.item.tone === 'red' ? 6 : 5}%, transparent)`;
});
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="ade-needs-item" :data-kind="item.kind" :data-item-id="item.id">
    <div
      class="grid grid-cols-[92px_60px_92px_70px_minmax(0,1fr)] items-center gap-x-3 rounded-kira border border-border px-3 py-2"
      :style="{ background: rowBackground }"
    >
      <span
        class="whitespace-nowrap rounded-kira-sm px-2 py-0.5 text-center text-kira-sm font-bold"
        :style="tagStyle(item.tone)"
        data-testid="ade-needs-kind"
        >{{ item.kind }}</span
      >
      <span class="text-kira-md text-muted-foreground" data-testid="ade-needs-age">{{ shortAge(item.ageMs) }}</span>
      <Button
        size="xs"
        class="rounded-kira font-semibold"
        :style="buttonStyle"
        :disabled="busy"
        data-testid="ade-needs-action"
        @click="perform(item)"
      >
        {{ item.action }}
      </Button>
      <span class="truncate text-kira-sm text-subtle" data-testid="ade-needs-scope">{{ item.scope }}</span>
      <div class="flex min-w-0 flex-col">
        <span class="flex items-center gap-2">
          <span class="truncate text-kira-md text-fg" data-testid="ade-needs-what">{{ item.what }}</span>
          <button
            v-if="hasLog"
            type="button"
            class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-kira-sm text-muted-foreground underline"
            data-testid="ade-needs-log"
            @click="logOpen = !logOpen"
          >
            {{ logOpen ? 'Hide log' : 'Log' }}
          </button>
        </span>
        <span v-if="item.detail" class="truncate text-kira-sm text-muted-foreground" data-testid="ade-needs-detail">{{ item.detail }}</span>
        <span class="flex items-center gap-1 truncate text-kira-sm text-subtle">
          <span class="inline-block size-2 shrink-0 rounded-[2px]" :style="{ background: taskColor }" />
          {{ taskTitle }}
        </span>
      </div>
    </div>
    <AdeRunLog v-if="logOpen && hasLog" kind="run" :id="item.runIds[0] ?? ''" max-height="160px" />
  </div>
</template>
