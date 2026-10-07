<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
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
    class="box-border inline-flex h-7 max-w-80 items-center gap-1.5 rounded-kira border border-border-strong py-0 pl-1 pr-0.5"
    :class="shown ? 'bg-elevated' : 'bg-transparent opacity-50'"
    data-testid="ade-repo-chip"
    :data-repo-id="codeRepoId"
  >
    <AdeTip text="Show or hide this repo">
      <button
        type="button"
        class="h-5 shrink-0 cursor-pointer rounded-kira-xs border-0 px-[5px] py-px font-data text-kira-sm font-semibold"
        :style="nameStyle"
        :aria-pressed="shown"
        data-testid="ade-repo-toggle"
        @click="emit('toggle')"
      >
        {{ label }}
      </button>
    </AdeTip>
    <span
      class="min-w-0 truncate text-kira-sm"
      :class="error ? '' : 'text-subtle'"
      :style="error ? { color: TONE.red[1] } : undefined"
      data-testid="ade-repo-note"
      >{{ note }}</span
    >
    <AdeTip :text="`Fetch ${label}`">
      <button
        type="button"
        class="flex size-control items-center justify-center rounded-kira-sm border-0 bg-transparent p-0 text-fg disabled:opacity-50"
        :disabled="busy"
        :aria-label="`Refresh ${label}`"
        data-testid="ade-repo-refresh"
        @click="emit('refresh')"
      >
        <CodiconIcon name="refresh" :size="12" />
      </button>
    </AdeTip>
  </span>
</template>
