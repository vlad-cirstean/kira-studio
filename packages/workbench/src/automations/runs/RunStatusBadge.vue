<script setup lang="ts">
import type { ScriptRunState } from '@shared/domain/scriptRuns';
import type { BadgeVariants } from '@theme/components/ui/badge';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { stateLabel } from './runText';

const props = defineProps<{ state: ScriptRunState }>();

const VARIANT: Record<ScriptRunState, NonNullable<BadgeVariants['variant']>> = {
  running: 'info',
  done: 'ok',
  failed: 'err',
  cancelled: 'default',
  blocked: 'warn',
  waiting: 'warn',
  skipped: 'default',
};
const variant = computed(() => VARIANT[props.state]);
</script>

<template>
  <Badge :variant="variant" data-testid="run-status" :data-state="state">{{ stateLabel(state) }}</Badge>
</template>
