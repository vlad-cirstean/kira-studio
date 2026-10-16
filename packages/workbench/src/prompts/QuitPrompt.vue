<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { t } from '@theme/i18n';
import { computed, inject } from 'vue';
import { errorText } from '../bridge/codedError';
import ConfirmDialogView from '../components/ConfirmDialogView.vue';
import { appUpdateStoreKey } from '../state/createAppUpdateStore';
import { usePromptsControl } from './promptsQueries';

// The routed `quit` popup: quitting would stop live agent work. Cancel, Escape and the frame's
// close all cancel; the router entry closes from Go.
defineProps<{ entry: RoutedPrompt; more: number }>();
const control = usePromptsControl();
const app = inject(appUpdateStoreKey);
if (!app) throw new Error('appUpdateStoreKey is not provided');

const { data } = useQuery({
  queryKey: ['lifecycle', 'quitStatus'],
  queryFn: () => control.quitStatus(),
  staleTime: 0,
});
const confirm = useMutation({ mutationFn: () => control.quitConfirm() });
const cancel = useMutation({ mutationFn: () => control.quitCancel() });

const message = computed(() => {
  const s = data.value;
  if (!s) return '';
  const lines = [
    t('workbench.quitConfirm.body', { count: s.agents + s.runs + s.scripts }),
    ...(s.agents ? [t('workbench.quitConfirm.agents.label', { count: s.agents })] : []),
    ...(s.runs ? [t('workbench.quitConfirm.runs.label', { count: s.runs })] : []),
    ...(s.scripts ? [t('workbench.quitConfirm.scripts.label', { count: s.scripts })] : []),
  ];
  return lines.join('\n');
});
const error = computed(() => {
  const e = confirm.error.value ?? cancel.error.value;
  return e ? errorText(e) : '';
});
</script>

<template>
  <ConfirmDialogView
    open
    tone="danger"
    :title="t('workbench.quitConfirm.title', { app: app.appName })"
    :message="message"
    :confirm-label="t('workbench.quitConfirm.quit.label')"
    :pending="confirm.isPending.value || cancel.isPending.value"
    :error="error"
    @confirm="confirm.mutate()"
    @cancel="cancel.mutate()"
  />
</template>
