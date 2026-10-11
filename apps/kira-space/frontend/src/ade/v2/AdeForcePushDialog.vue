<script setup lang="ts">
import ConfirmDialogView from '@workbench/components/ConfirmDialogView.vue';
import { computed } from 'vue';
import { remoteErrorText } from './board/panelFacts';
import { useForcePush } from './queries';
import { useConfirmRun } from './useConfirmRun';

// Force push with lease for one branch; the backend refuses a stale lease and the message shows here.
const props = defineProps<{ target: { branchId: string; branchName: string; repo: string } | null }>();
const emit = defineEmits<{ close: [] }>();

const forcePush = useForcePush();
const title = computed(() =>
  props.target ? `Force push ${props.target.branchName} (repo ${props.target.repo}) with lease?` : '',
);

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
    :title="title"
    message="Replaces the remote branch with your local one; refused when someone else pushed since your last fetch."
    confirm-label="Force push"
    tone="danger"
    :busy="busy"
    :error="error ?? ''"
    :testids="{ root: 'ade-confirm-dialog', cancel: 'ade-confirm-no', confirm: 'ade-confirm-yes', error: 'ade-confirm-error' }"
    @confirm="confirm"
    @cancel="emit('close')"
  />
</template>
