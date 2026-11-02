<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { appUpdateStoreKey } from '@workbench/state/createAppUpdateStore';
import { computed, inject, ref } from 'vue';
import RunsRestoreDialog from './RunsRestoreDialog.vue';
import { useRunsRestoreState } from './restoreQueries';

// The scripts a quit or crash ended, offered again. Nothing opens by itself: the person reviews them here.
const app = inject(appUpdateStoreKey);
const state = useRunsRestoreState();
const open = ref(false);
const items = computed(() => state.data.value?.items ?? []);

async function review(): Promise<void> {
  const fresh = await state.refetch();
  open.value = (fresh.data?.items.length ?? 0) > 0;
}
</script>

<template>
  <template v-if="items.length > 0">
    <Alert variant="info" strip data-testid="runs-restore-banner">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div class="min-w-0 flex-1 basis-48">
          <AlertDescription>{{
            t('automations.restore.banner.body', { count: items.length, app: app?.appName ?? '' })
          }}</AlertDescription>
        </div>
        <Button
          variant="dialog"
          size="kira"
          class="ml-auto shrink-0"
          data-testid="runs-restore-review"
          @click="review"
        >
          {{ t('automations.restore.banner.review.label') }}
        </Button>
      </div>
    </Alert>
    <RunsRestoreDialog v-if="open" :items="items" @close="open = false" />
  </template>
</template>
