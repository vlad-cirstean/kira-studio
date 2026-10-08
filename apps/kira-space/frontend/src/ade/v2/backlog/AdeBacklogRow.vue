<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { useTimeAgo } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import AdeTip from '../AdeTip.vue';
import { adeAgoOptions } from '../ago';
import { parseGithub } from '../board/panelFacts';
import { TONE_SOLID_CLASS } from '../tones';
import type { BacklogItem } from '../wire';

// One backlog line: reorder, promote, delete, added-ago, inline-edit text and quiet link facts.
const props = defineProps<{ item: BacklogItem; selected: boolean }>();
const emit = defineEmits<{
  pick: [];
  move: [delta: -1 | 1];
  promote: [];
  remove: [];
  edit: [text: string];
}>();

const ago = useTimeAgo(() => props.item.addedAt, adeAgoOptions);
const draft = ref(props.item.text);
watch(
  () => props.item.text,
  (t) => {
    draft.value = t;
  },
);

const facts = computed(() => {
  const gh = parseGithub(props.item.githubUrl);
  return [
    props.item.jira?.key ?? '',
    gh ? `${gh.kind === 'PR' ? 'PR' : 'issue'} ${gh.ref}` : '',
    props.item.notes ? 'notes' : '',
  ]
    .filter(Boolean)
    .join(' · ');
});

function commit(): void {
  const text = draft.value.trim();
  if (!text) {
    draft.value = props.item.text;
    return;
  }
  if (text !== props.item.text) emit('edit', text);
}
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: the row holds inputs and buttons a button cannot. -->
  <div
    class="box-border flex min-h-9 cursor-pointer items-center gap-2 border-b border-border border-l-3 px-3 py-1"
    :class="selected ? 'bg-select border-l-tone-amber-solid' : 'border-l-transparent hover:bg-hover'"
    role="button"
    tabindex="0"
    :data-selected="selected || undefined"
    data-testid="ade-backlog-row"
    :data-item-id="item.id"
    @click="emit('pick')"
    @keydown.self.enter="emit('pick')"
    @keydown.self.space.prevent="emit('pick')"
  >
    <AdeTip text="Higher priority">
      <Button
        variant="toolbar"
        size="kira-icon"
        aria-label="Move up"
        data-testid="ade-backlog-up"
        @click.stop="emit('move', -1)"
      >
        ↑
      </Button>
    </AdeTip>
    <AdeTip text="Lower priority">
      <Button
        variant="toolbar"
        size="kira-icon"
        aria-label="Move down"
        data-testid="ade-backlog-down"
        @click.stop="emit('move', 1)"
      >
        ↓
      </Button>
    </AdeTip>
    <AdeTip text="Turn into a task (lands in Later on the plan)">
      <Button
        size="kira"
        class="shrink-0 font-semibold"
        :class="TONE_SOLID_CLASS.amber"
        data-testid="ade-backlog-promote"
        @click.stop="emit('promote')"
      >
        → Task
      </Button>
    </AdeTip>
    <AdeTip text="Delete">
      <Button
        variant="toolbar"
        size="kira-icon"
        class="text-error"
        aria-label="Delete"
        data-testid="ade-backlog-delete"
        @click.stop="emit('remove')"
      >
        ✕
      </Button>
    </AdeTip>
    <span class="w-16 shrink-0 text-kira-sm text-subtle" data-testid="ade-backlog-ago">{{ ago }}</span>
    <label :for="`ade-backlog-${item.id}`" class="sr-only">Backlog item</label>
    <Input
      :id="`ade-backlog-${item.id}`"
      v-model="draft"
      class="min-w-0 flex-1 border-transparent bg-transparent px-2 focus-visible:border-focus dark:bg-transparent"
      data-testid="ade-backlog-text"
      @blur="commit"
      @keydown.enter="commit"
    />
    <span v-if="facts" class="max-w-2/5 shrink-0 truncate text-kira-sm text-subtle" data-testid="ade-backlog-facts">{{ facts }}</span>
  </div>
</template>
