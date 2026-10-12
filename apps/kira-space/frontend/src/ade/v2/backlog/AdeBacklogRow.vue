<script setup lang="ts">
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useRelativeTime } from '@workbench/behaviour/format';
import { useInlineEdit } from '@workbench/behaviour/inlineEdit';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
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

const ago = useRelativeTime(() => props.item.addedAt);
const edit = useInlineEdit({ source: () => props.item.text, commit: (text) => emit('edit', text) });

const facts = computed(() => {
  const gh = parseGithub(props.item.githubUrl);
  return [
    props.item.jira?.key ?? '',
    gh
      ? t(gh.kind === 'PR' ? 'space.common.githubPr.label' : 'space.common.githubIssue.label', {
          ref: gh.ref,
        })
      : '',
    props.item.notes ? t('space.common.notes.label') : '',
  ]
    .filter(Boolean)
    .join(' · ');
});
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: the row holds inputs and buttons a button cannot. -->
  <div
    :class="cn(rowVariants({ layout: 'tree', selected }), 'cursor-pointer gap-2 border-b border-border py-1')"
    :style="rowIndent(0)"
    role="button"
    tabindex="0"
    :data-selected="selected || undefined"
    data-testid="ade-backlog-row"
    :data-item-id="item.id"
    @click="emit('pick')"
    @keydown.self.enter="emit('pick')"
    @keydown.self.space.prevent="emit('pick')"
  >
    <AdeTip :text="t('common.moveUp.tooltip')">
      <Button
        variant="toolbar"
        size="kira-icon"
        :aria-label="t('common.moveUp.tooltip')"
        data-testid="ade-backlog-up"
        @click.stop="emit('move', -1)"
      >
        ↑
      </Button>
    </AdeTip>
    <AdeTip :text="t('common.moveDown.tooltip')">
      <Button
        variant="toolbar"
        size="kira-icon"
        :aria-label="t('common.moveDown.tooltip')"
        data-testid="ade-backlog-down"
        @click.stop="emit('move', 1)"
      >
        ↓
      </Button>
    </AdeTip>
    <AdeTip :text="t('space.ade.backlog.promoteRow.tooltip')">
      <Button
        variant="dialog"
        size="kira"
        class="shrink-0 "
        :class="TONE_SOLID_CLASS.amber"
        data-testid="ade-backlog-promote"
        @click.stop="emit('promote')"
      >
        {{ t('space.ade.backlog.promoteRow.label') }}
      </Button>
    </AdeTip>
    <AdeTip :text="t('common.action.delete.label')">
      <Button
        variant="toolbar"
        size="kira-icon"
        class="text-error"
        :aria-label="t('common.action.delete.label')"
        data-testid="ade-backlog-delete"
        @click.stop="emit('remove')"
      >
        ✕
      </Button>
    </AdeTip>
    <span class="w-16 shrink-0 text-kira-sm text-subtle" data-testid="ade-backlog-ago">{{
      ago
    }}</span>
    <Label :for="`ade-backlog-${item.id}`" class="sr-only">{{
      t('space.ade.backlog.item.label')
    }}</Label>
    <Input
      :id="`ade-backlog-${item.id}`"
      :model-value="edit.text.value"
      class="min-w-0 flex-1 border-transparent bg-transparent px-2 dark:bg-transparent"
      data-testid="ade-backlog-text"
      @update:model-value="edit.onInput"
      @blur="edit.onCommit"
      @keydown="edit.onKeydown"
    />
    <span
      v-if="facts"
      class="max-w-2/5 shrink-0 truncate text-kira-sm text-subtle"
      data-testid="ade-backlog-facts"
      >{{
        facts
      }}</span
    >
  </div>
</template>
