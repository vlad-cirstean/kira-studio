<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { useRelativeTime } from '@workbench/behaviour/format';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { activityLabel } from '../activity';
import type { SessionView } from '../sessions/sessionView';

// One running agent in the status bar popover: glyph, task, and where/what/how long.
const props = defineProps<{ view: SessionView; title: string }>();
defineEmits<{ open: [] }>();

const ago = useRelativeTime(() => props.view.session.lastActiveAt);
</script>

<template>
  <Button
    variant="toolbar"
    size="inline"
    class="w-full justify-start gap-2 px-2 py-1.5 text-left font-normal"
    data-testid="status-agents-row"
    :data-session-id="view.session.id"
    :data-kind="view.kind"
    @click="$emit('open')"
  >
    <AdeActivityIcon :kind="view.kind" :size="14" bare class="w-5" />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-kira-md text-fg">{{ title }}</span>
      <span class="truncate text-kira-sm text-muted-foreground">{{
        t('space.statusBar.agents.rowMeta.label', {
          where: view.tabName,
          activity: activityLabel(view.kind),
          ago,
        })
      }}</span>
    </span>
  </Button>
</template>
