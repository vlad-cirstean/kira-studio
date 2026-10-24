<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
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
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div class="min-w-0 flex-1 basis-48">
          <AlertDescription>
            <span class="block">{{
              t('docker.restore.banner.body', { count: pending.items.length })
            }}</span>
            <span
              v-if="starting"
              class="block text-kira-sm"
              data-testid="docker-restore-starting"
              >{{
                t('docker.restore.banner.starting.status', { count: starting })
              }}</span
            >
          </AlertDescription>
        </div>
        <Button
          variant="dialog"
          size="kira"
          class="ml-auto shrink-0"
          data-testid="docker-restore-review"
          @click="open = true"
          >{{
            t('docker.restore.banner.review.label')
          }}</Button
        >
      </div>
    </Alert>
    <RestoreDialog v-if="open" :state="pending" @close="open = false" />
  </template>
</template>
