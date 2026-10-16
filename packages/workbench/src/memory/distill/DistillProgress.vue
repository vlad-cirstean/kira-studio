<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { storeToRefs } from 'pinia';
import { formatCurrency } from '../../behaviour/format';
import { useDistillUiStore } from './distillStore';

// P285 Part 4: the running distill's progress line and its Cancel.
const ui = useDistillUiStore();
const { progress } = storeToRefs(ui);
</script>

<template>
  <Spinner />
  <span class="text-kira-sm text-muted-foreground" data-testid="distill-progress">{{
    progress
      ? t('memory.distill.progress.status', {
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
