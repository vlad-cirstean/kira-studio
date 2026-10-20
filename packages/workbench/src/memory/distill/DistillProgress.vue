<script setup lang="ts">
import type { DistillStage } from '@shared/domain/memoryDistill';
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import type { MessageKey } from '@theme/i18n';
import { t } from '@theme/i18n';
import { storeToRefs } from 'pinia';
import { formatCurrency } from '../../behaviour/format';
import { useDistillUiStore } from './distillStore';

// P285 Part 4: the running distill's progress line and its Cancel.
const ui = useDistillUiStore();
const { progress } = storeToRefs(ui);

const STAGE_STATUS = {
  extract: 'memory.distill.progress.extract.status',
  verify: 'memory.distill.progress.verify.status',
  merge: 'memory.distill.progress.merge.status',
  rewrite: 'memory.distill.progress.rewrite.status',
} as const satisfies Record<DistillStage, MessageKey>;
</script>

<template>
  <Spinner />
  <span class="text-kira-sm text-muted-foreground" data-testid="distill-progress">{{
    progress
      ? t(STAGE_STATUS[progress.stage], {
          done: progress.done,
          total: progress.total,
          cost: formatCurrency(progress.costUsd),
        })
      : t('common.state.loading.loading')
  }}</span>
  <Button variant="dialog" size="kira" data-testid="distill-cancel" @click="ui.cancel()">{{
    t('common.action.cancel.label')
  }}</Button>
</template>
