<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTIVITY_LABEL, shortId } from '../activity';
import { adeAgoOptions } from '../ago';
import type { SessionView } from '../sessions/sessionView';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { actionStyle, TONE } from '../tones';
import { useNeedsAction } from './useNeedsAction';

// One session row of All sessions (mockup `agents`): glyph, state, age, button, id, repo, step and
// where it runs. A click opens it in its Sessions tab.
const props = defineProps<{ view: SessionView; archived: boolean }>();

const takeOver = useAdeTakeOverStore();
const { openSession } = useNeedsAction();
const ago = useTimeAgo(() => props.view.session.lastActiveAt, adeAgoOptions);

const running = computed(() => props.view.session.state === 'running');
const input = computed(() => running.value && props.view.kind === 'input');
const state = computed(() => {
  if (props.archived) return 'stopped · archived';
  if (props.view.headless && input.value) return 'stuck · needs you';
  return ACTIVITY_LABEL[props.view.kind];
});
const stateColor = computed(() => {
  if (!running.value) return 'var(--kira-fg-muted)';
  if (props.view.kind === 'input') return TONE.amber[1];
  if (props.view.kind === 'working') return TONE.green[1];
  return props.view.kind === 'waiting' ? TONE.blue[1] : 'var(--kira-fg-muted)';
});
/** A live interactive session opens; everything else is taken over. */
const opens = computed(() => running.value && !props.view.headless);

function open(): void {
  const s = props.view.session;
  void openSession(s.id, s.taskId, s.branchId);
}
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: the row holds a button; a button cannot nest one. -->
  <div
    role="button"
    tabindex="0"
    class="grid cursor-pointer grid-cols-[20px_130px_76px_92px_90px_64px_minmax(0,1fr)] items-center gap-x-3 rounded-kira px-3 py-1.5"
    :style="input ? { background: `color-mix(in srgb, ${TONE.amber[2]} 7%, transparent)` } : undefined"
    data-testid="ade-all-session"
    :data-session-id="view.session.id"
    @click="open"
    @keydown.enter.self="open"
    @keydown.space.self.prevent="open"
  >
    <AdeActivityIcon :kind="view.kind" :size="14" />
    <span class="truncate text-kira-md" :style="{ color: stateColor }" data-testid="ade-all-state">{{ state }}</span>
    <span class="text-kira-md text-muted-foreground">{{ ago }}</span>
    <Button
      v-if="!archived"
      size="xs"
      :variant="opens ? 'dialog' : undefined"
      class="rounded-kira font-semibold"
      :style="opens ? undefined : actionStyle('claude')"
      :disabled="takeOver.pending.has(view.session.id)"
      data-testid="ade-all-action"
      @click.stop="opens ? open() : takeOver.request(view.session.id)"
    >
      {{ opens ? 'Open' : 'Take over' }}
    </Button>
    <span v-else />
    <span class="font-data text-kira-sm text-muted-foreground">claude {{ shortId(view.session.id) }}</span>
    <span class="truncate font-data text-kira-sm text-subtle">{{ view.repo || 'spec' }}</span>
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-kira-md">{{ view.allLabel }}</span>
      <span class="truncate font-data text-kira-sm text-subtle">{{ view.branch }} {{ view.worktree }}</span>
    </div>
  </div>
</template>
