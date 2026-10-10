<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTIVITY_LABEL, shortId } from '../activity';
import { adeAgoOptions } from '../ago';
import type { SessionView } from '../sessions/sessionView';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { ACTION_CLASS } from '../tones';
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
const stateClass = computed(() => {
  if (!running.value) return 'text-muted-foreground';
  if (props.view.kind === 'input') return 'text-tone-amber';
  if (props.view.kind === 'working') return 'text-tone-green';
  return props.view.kind === 'waiting' ? 'text-tone-blue' : 'text-muted-foreground';
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
    class="flex cursor-pointer items-center gap-3 rounded-kira px-3 py-1.5"
    :class="input && 'bg-tone-amber-solid/7'"
    data-testid="ade-all-session"
    :data-session-id="view.session.id"
    @click="open"
    @keydown.enter.self="open"
    @keydown.space.self.prevent="open"
  >
    <AdeActivityIcon :kind="view.kind" :size="14" class="w-5 shrink-0" />
    <span class="w-32.5 shrink-0 truncate text-kira-md" :class="stateClass" data-testid="ade-all-state">{{ state }}</span>
    <span class="w-19 shrink-0 text-kira-md text-muted-foreground">{{ ago }}</span>
    <Button
      v-if="!archived"
      size="kira-lg"
      :variant="opens ? 'dialog' : undefined"
      class="w-23 shrink-0 "
      :class="opens ? undefined : ACTION_CLASS.claude"
      :disabled="takeOver.pending.has(view.session.id)"
      data-testid="ade-all-action"
      @click.stop="opens ? open() : takeOver.request(view.session.id)"
    >
      {{ opens ? 'Open' : 'Take over' }}
    </Button>
    <span v-else class="w-23 shrink-0" />
    <span class="w-22.5 shrink-0 font-data text-kira-sm text-muted-foreground">claude {{ shortId(view.session.id) }}</span>
    <span class="w-16 shrink-0 truncate text-kira-sm text-subtle">{{ view.repo || 'spec' }}</span>
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-kira-md">{{ view.allLabel }}</span>
      <span class="truncate font-data text-kira-sm text-subtle">{{ view.branch }} {{ view.worktree }}</span>
    </div>
  </div>
</template>
