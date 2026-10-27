<script setup lang="ts">
import { t } from '@theme/i18n';
import AdeStoppedRow from './AdeStoppedRow.vue';
import type { SessionView } from './sessionView';

// Finished / stopped sessions: age, Take over, label. A background run's label opens its log inline.
// `popover` fills the dropdown of a task or branch; `inline` lists them in the archived panel.
withDefaults(
  defineProps<{
    views: SessionView[];
    archived?: boolean;
    variant?: 'inline' | 'popover';
    selectedId?: string | null;
  }>(),
  { variant: 'inline', selectedId: null },
);
const emit = defineEmits<{ tookOver: [] }>();
</script>

<template>
  <div
    v-if="views.length"
    :class="
      variant === 'inline'
        ? 'flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-3 pb-2.5 pt-2'
        : 'flex flex-col gap-1'
    "
    data-testid="ade-stopped-list"
  >
    <div v-if="variant === 'inline'" class="text-kira-sm text-muted-foreground">{{
      t('space.ade.sessionList.stopped.label')
    }}</div>
    <AdeStoppedRow
      v-for="v in views"
      :key="v.session.id"
      :view="v"
      :archived="archived"
      :selected="v.session.id === selectedId"
      @took-over="emit('tookOver')"
    />
  </div>
</template>
