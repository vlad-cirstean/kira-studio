<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { shortAge } from '../ago';
import type { Tone } from '../board/actions';
import type { NeedsItem } from '../board/needsYou';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { ACTION_CLASS, TONE_SOLID_CLASS, TONE_TAG_CLASS } from '../tones';
import { useNeedsAction } from './useNeedsAction';

// One needs-you item (mockup `needs`): kind chip, age, its one action, scope, what, over the task.
const props = defineProps<{ item: NeedsItem; taskTitle: string; taskColor: string }>();

const { perform, busy } = useNeedsAction();
const logOpen = ref(false);
const hasLog = computed(
  () => (props.item.kind === 'stuck run' || props.item.kind === 'failed') && props.item.runIds.length > 0,
);
const buttonClass = computed(() => {
  if (props.item.action === 'Take over') return ACTION_CLASS.claude;
  return props.item.tone === 'grey' ? 'bg-border-strong text-fg' : TONE_SOLID_CLASS[props.item.tone];
});
const ROW_BG_CLASS: Record<Tone, string> = {
  amber: 'bg-tone-amber-solid/5',
  red: 'bg-tone-red-solid/6',
  green: 'bg-tone-green-solid/5',
  blue: 'bg-tone-blue-solid/5',
  purple: 'bg-tone-purple-solid/5',
  grey: 'bg-elevated',
};
</script>

<template>
  <div class="flex flex-col border-b border-border" data-testid="ade-needs-item" :data-kind="item.kind" :data-item-id="item.id">
    <div
      class="flex items-center gap-3 px-3 py-2"
      :class="ROW_BG_CLASS[item.tone]"
    >
      <span
        class="w-23 shrink-0 whitespace-nowrap rounded-kira-sm px-2 py-0.5 text-center text-kira-sm"
        :class="TONE_TAG_CLASS[item.tone]"
        data-testid="ade-needs-kind"
        >{{ item.kind }}</span
      >
      <span class="w-15 shrink-0 text-kira-md text-muted-foreground" data-testid="ade-needs-age">{{ shortAge(item.ageMs) }}</span>
      <Button variant="dialog"
        size="kira-lg"
        class="w-23 shrink-0 "
        :class="buttonClass"
        :disabled="busy"
        data-testid="ade-needs-action"
        @click="perform(item)"
      >
        {{ item.action }}
      </Button>
      <span class="w-17.5 shrink-0 truncate text-kira-sm text-subtle" data-testid="ade-needs-scope">{{ item.scope }}</span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-center gap-2">
          <span class="truncate text-kira-md text-fg" data-testid="ade-needs-what">{{ item.what }}</span>
          <Button
            v-if="hasLog"
            variant="ghost"
            size="kira"
            class="shrink-0 text-kira-sm text-muted-foreground underline"
            data-testid="ade-needs-log"
            @click="logOpen = !logOpen"
          >
            {{ logOpen ? 'Hide log' : 'Log' }}
          </Button>
        </span>
        <span v-if="item.detail" class="truncate text-kira-sm text-muted-foreground" data-testid="ade-needs-detail">{{ item.detail }}</span>
        <span class="flex items-center gap-1 truncate text-kira-sm text-subtle">
          <span class="inline-block size-2 shrink-0 rounded-kira-xs" :style="{ background: taskColor }" />
          {{ taskTitle }}
        </span>
      </div>
    </div>
    <AdeRunLog v-if="logOpen && hasLog" kind="run" :id="item.runIds[0] ?? ''" max-height="160px" />
  </div>
</template>
