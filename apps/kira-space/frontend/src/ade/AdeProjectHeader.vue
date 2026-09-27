<script setup lang="ts">
import { useIsMutating } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import { adeRefreshKey, useAdeRefresh } from './queries';
import type { AdeRefreshNote } from './state/adeUi';
import { useAdeUiStore } from './state/adeUi';

// P129 Part 3 §0.16/§2.7: mockup lines 90-98's own header row, ported field by field — the note
// persists (runtime, per repo) until the next Refresh (adeUiStore.refreshNote), and the pending
// state is read via `useIsMutating` rather than this component's own mutation object, so it
// survives a repo-tab remount (queries.ts's own doc comment).
const props = defineProps<{
  codeRepoId: string;
  projectName: string;
  lastFetchAt: number | null;
  autofetchMinutes: number;
}>();

const adeUiStore = useAdeUiStore();
const refreshMutation = useAdeRefresh(() => props.codeRepoId);
const pendingCount = useIsMutating(() => ({ mutationKey: adeRefreshKey(props.codeRepoId) }));
const isPending = computed(() => pendingCount.value > 0);

// §0.16: "just now" / "Nm ago" / "Nh ago" / "Nd ago" — the mockup's own ago() thresholds (line
// 1343: <60min, <1440min, else), plus "just now" for the first minute (the mockup's own `f2`
// fixture value right after a refresh completes, line 725).
const ago = useTimeAgo(() => props.lastFetchAt ?? 0, {
  messages: {
    justNow: 'just now',
    past: (n: string) => `${n} ago`,
    future: (n: string) => `${n} ago`,
    invalid: '',
    minute: (n: number) => `${n}m`,
    hour: (n: number) => `${n}h`,
    day: (n: number) => `${n}d`,
  },
  units: [
    { max: 3_600_000, value: 60_000, name: 'minute' },
    { max: 86_400_000, value: 3_600_000, name: 'hour' },
    { max: Number.POSITIVE_INFINITY, value: 86_400_000, name: 'day' },
  ],
});

const note = computed(() => adeUiStore.refreshNote[props.codeRepoId]);

function okNoteText(n: Extract<AdeRefreshNote, { kind: 'ok' }>): string {
  if (n.refsChanged === 0 && n.newlyMerged.length === 0) return 'no changes';
  const parts = [`${n.refsChanged} ref${n.refsChanged === 1 ? '' : 's'} changed`];
  if (n.newlyMerged.length > 0) parts.push(`${n.newlyMerged.length} merged`);
  if (n.refsChanged > 0) parts.push('conflicts rechecked');
  return parts.join(' · ');
}

const fetchLabel = computed(() => {
  const n = note.value;
  if (n?.kind === 'error') return `fetch failed · ${n.message}`;
  if (isPending.value) return 'fetching…';
  const base =
    props.lastFetchAt === null
      ? 'never fetched'
      : n?.kind === 'ok'
        ? `${ago.value} · ${okNoteText(n)}`
        : `fetched ${ago.value}`;
  const autofetch =
    props.autofetchMinutes === 0 ? 'autofetch off' : `autofetch every ${props.autofetchMinutes}m`;
  return `${base} · ${autofetch}`;
});

// Mockup fetchLabelStyle (line 1771): brighter once there's a real note to show, muted otherwise —
// danger is this component's own addition for the error rung (§0.16), a genuine tone, so a theme
// token, not a literal tint.
const fetchLabelClass = computed(() => {
  if (note.value?.kind === 'error') return 'text-error';
  if (note.value?.kind === 'ok' && (note.value.refsChanged > 0 || note.value.newlyMerged.length > 0)) {
    return 'text-fg';
  }
  return 'text-muted-foreground';
});
</script>

<template>
  <div class="ml-15 flex items-center gap-2.5 py-2 pl-2">
    <span class="font-data text-kira-md font-semibold" data-testid="ade-project-name">{{
      projectName
    }}</span>
    <Tooltip>
      <TooltipTrigger as-child>
        <span
          class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm"
          :class="fetchLabelClass"
          data-testid="ade-fetch-label"
          >{{ fetchLabel }}</span
        >
      </TooltipTrigger>
      <TooltipContent>{{ fetchLabel }}</TooltipContent>
    </Tooltip>
    <span class="flex-1" />
    <Button
      variant="secondary"
      size="sm"
      :disabled="isPending"
      title="Fetch this project and recheck conflicts"
      data-testid="ade-refresh"
      @click="refreshMutation.mutate()"
    >
      <CodiconIcon name="refresh" :size="13" />
      {{ isPending ? 'Refreshing…' : 'Refresh' }}
    </Button>
  </div>
</template>
