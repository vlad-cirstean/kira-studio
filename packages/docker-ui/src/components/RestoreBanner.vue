<script setup lang="ts">
import { Alert, AlertAction, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import { useRestoreState } from '../queries';
import RestoreDialog from './RestoreDialog.vue';

const restore = useRestoreState();
const open = ref(false);

const pending = computed(() =>
  restore.data.value?.state === 'pending' ? restore.data.value : null,
);
const starting = computed(
  () => pending.value?.items.filter((i) => i.status === 'waiting').length ?? 0,
);
</script>

<template>
  <template v-if="pending">
    <Alert variant="info" strip data-testid="docker-restore-banner">
      <AlertDescription>
        {{ t('docker.restore.banner.body', { count: pending.items.length }) }}
        <span v-if="starting" data-testid="docker-restore-starting">{{
          t('docker.restore.banner.starting.status', { count: starting })
        }}</span>
      </AlertDescription>
      <AlertAction>
        <Button
          variant="toolbar"
          size="kira"
          data-testid="docker-restore-review"
          @click="open = true"
          >{{
            t('docker.restore.banner.review.label')
          }}</Button
        >
      </AlertAction>
    </Alert>
    <RestoreDialog v-if="open" :state="pending" @close="open = false" />
  </template>
</template>
