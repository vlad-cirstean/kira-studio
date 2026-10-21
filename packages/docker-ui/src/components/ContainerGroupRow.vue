<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { rowActions, rowIndent, rowMeta, rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import OriginIcon from './OriginIcon.vue';

defineProps<{ name: string; running: number; total: number; open: boolean }>();

const emit = defineEmits<{
  toggle: [string];
  groupAction: [string, 'start' | 'stop'];
}>();

const rowClass = cn(rowVariants({ layout: 'tree' }), 'group/row h-full');
const indent = rowIndent(0);
</script>

<template>
  <div :class="rowClass" :style="indent" data-testid="docker-group" :data-project="name">
    <TreeTwisty :expanded="open" :has-children="true" @toggle="emit('toggle', name)" />
    <OriginIcon tip="attribute" origin="compose" data-testid="docker-group-icon" />
    <button
      type="button"
      class="min-w-0 flex-1 cursor-default truncate border-0 bg-transparent p-0 text-left font-medium text-inherit"
      :aria-expanded="open"
      @click="emit('toggle', name)"
      >{{
        name
      }}</button
    >
    <span :class="rowMeta">{{ running }}/{{ total }}</span>
    <span :class="cn('flex items-center', rowActions)">
      <Button
        variant="toolbar"
        size="kira-icon"
        :aria-label="t('common.action.startAll.label')"
        :data-kira-tip="t('common.action.startAll.label')"
        data-tone="ok"
        data-testid="docker-group-start"
        @click="emit('groupAction', name, 'start')"
      >
        <CodiconIcon name="play" :size="13" />
      </Button>
      <Button
        variant="toolbar"
        size="kira-icon"
        :aria-label="t('common.action.stopAll.label')"
        :data-kira-tip="t('common.action.stopAll.label')"
        data-tone="error"
        data-testid="docker-group-stop"
        @click="emit('groupAction', name, 'stop')"
      >
        <CodiconIcon name="debug-stop" :size="13" />
      </Button>
    </span>
  </div>
</template>
