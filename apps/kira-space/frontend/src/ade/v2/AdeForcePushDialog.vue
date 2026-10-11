<script setup lang="ts">
import { t } from '@theme/i18n';
import ConfirmDialogView from '@workbench/components/ConfirmDialogView.vue';
import { remoteErrorText } from './board/panelFacts';
import { useForcePush } from './queries';
import { useConfirmRun } from './useConfirmRun';

// Force push with lease for one branch; the backend refuses a stale lease and the message shows here.
const props = defineProps<{ target: { branchId: string; branchName: string; repo: string } | null }>();
const emit = defineEmits<{ close: [] }>();

const forcePush = useForcePush();
const { busy, error, confirm } = useConfirmRun(
  () => props.target !== null,
  async () => {
    if (!props.target) return null;
    const res = await forcePush.mutateAsync({ branchId: props.target.branchId });
    return res.error ? remoteErrorText(res.error) : null;
  },
  () => emit('close'),
);
</script>

<template>
  <ConfirmDialogView
    :open="target !== null"
    :title="t('space.ade.forcePushConfirm.title')"
    :message="t('space.ade.forcePushConfirm.body', { branch: target?.branchName ?? '', repo: target?.repo ?? '' })"
    :confirm-label="t('common.forcePush.label')"
    tone="danger"
    :busy="busy"
    :error="error ?? ''"
    :testids="{ root: 'ade-confirm-dialog', cancel: 'ade-confirm-no', confirm: 'ade-confirm-yes', error: 'ade-confirm-error' }"
    @confirm="confirm"
    @cancel="emit('close')"
  />
</template>
