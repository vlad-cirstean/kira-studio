<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { rowMeta } from '@theme/lib/rowVariants';
import AdeStoppedList from './AdeStoppedList.vue';
import type { SessionView } from './sessionView';

// Dropdown of the finished / stopped sessions in scope, with a count on the trigger.
defineProps<{ views: SessionView[]; selectedId: string | null }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <Popover v-if="views.length" v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="toolbar"
        size="kira-lg"
        class="shrink-0 gap-1"
        data-testid="ade-stopped-trigger"
      >
        {{ t('space.ade.sessionList.stopped.label') }}
        <span :class="rowMeta" data-testid="ade-stopped-count">{{ views.length }}</span>
        <CodiconIcon name="chevron-down" :size="12" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      class="max-h-80 w-96 overflow-auto p-1.5"
      data-testid="ade-stopped-popover"
      @open-auto-focus="(e) => selectedId && e.preventDefault()"
    >
      <AdeStoppedList
        variant="popover"
        :views="views"
        :selected-id="selectedId"
        @took-over="open = false"
      />
    </PopoverContent>
  </Popover>
</template>
