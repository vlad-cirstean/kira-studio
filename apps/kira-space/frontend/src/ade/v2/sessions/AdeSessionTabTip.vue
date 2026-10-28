<script setup lang="ts">
import { t } from '@theme/i18n';
import { useRelativeTime } from '@workbench/behaviour/format';
import { computed } from 'vue';
import { activityLabel } from '../activity';
import { runStateLabel } from '../runState';
import type { SessionView } from './sessionView';

// Tooltip body of a session tab: state and age. Mounted only while the tooltip is open.
const props = defineProps<{ view: SessionView }>();

const ago = useRelativeTime(() => props.view.session.lastActiveAt);
const text = computed(() => {
  const v = props.view;
  if (!v.headless)
    return t('space.ade.tui.status.label', { activity: activityLabel(v.kind), ago: ago.value });
  const runState = v.run?.state ?? '';
  const needsYou = runState === 'stuck' || v.session.activity === 'input';
  return t(
    needsYou ? 'space.ade.headless.statusNeedsYou.label' : 'space.ade.headless.status.label',
    {
      step: v.step,
      state: runState ? runStateLabel(runState) : activityLabel(v.kind),
      ago: ago.value,
    },
  );
});
</script>

<template>
  <span data-testid="ade-session-tip">{{ text }}</span>
</template>
