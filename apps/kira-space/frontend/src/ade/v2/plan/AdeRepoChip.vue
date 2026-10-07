<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Toggle } from '@theme/components/ui/toggle';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { adeAgoOptions } from '../ago';
import { repoColor } from '../palette';
import { TONE } from '../tones';

// One repo of the plan: name toggles its branches on and off, `↻` fetches just this repo.
const props = defineProps<{
  codeRepoId: string;
  label: string;
  lastFetchAt: number | null;
  shown: boolean;
  busy: boolean;
  error: string;
  /** What the last fetch changed, e.g. `3 refs changed`; `''` before any fetch. */
  summary: string;
}>();
const emit = defineEmits<{ toggle: []; refresh: [] }>();

const ago = useTimeAgo(() => props.lastFetchAt ?? 0, adeAgoOptions);
const note = computed(() => {
  if (props.busy) return 'fetching…';
  if (props.error) return props.error;
  if (props.lastFetchAt === null) return 'never fetched';
  return props.summary ? `${ago.value} · ${props.summary}` : String(ago.value);
});
const nameStyle = computed(() => {
  const c = repoColor(props.codeRepoId);
  return { background: `${c}1f`, color: c };
});
</script>

<template>
  <span
    class="inline-flex h-control-lg max-w-80 items-center gap-1.5 rounded-kira-sm border border-border-strong pl-0.5 pr-0.5"
    :class="shown ? 'bg-elevated' : 'bg-transparent opacity-50'"
    data-testid="ade-repo-chip"
    :data-repo-id="codeRepoId"
  >
    <AdeTip text="Show or hide this repo">
      <Toggle
        size="kira"
        class="shrink-0 px-1.5 font-semibold"
        :style="nameStyle"
        :model-value="shown"
        data-testid="ade-repo-toggle"
        @update:model-value="emit('toggle')"
      >
        {{ label }}
      </Toggle>
    </AdeTip>
    <span
      class="min-w-0 truncate text-kira-sm"
      :class="error ? '' : 'text-subtle'"
      :style="error ? { color: TONE.red[1] } : undefined"
      data-testid="ade-repo-note"
      >{{ note }}</span
    >
    <AdeTip :text="`Fetch ${label}`">
      <Button
        variant="toolbar"
        size="kira-icon"
        :disabled="busy"
        :aria-label="`Refresh ${label}`"
        data-testid="ade-repo-refresh"
        @click="emit('refresh')"
      >
        <CodiconIcon name="refresh" :size="12" />
      </Button>
    </AdeTip>
  </span>
</template>
