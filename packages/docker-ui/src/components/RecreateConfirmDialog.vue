<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import type { PendingChange } from '../lib/editDiff';
import type { DockerEditSpec } from '../wire';
import EditPendingSummary from './EditPendingSummary.vue';

defineProps<{ spec: DockerEditSpec; changes: PendingChange[]; busy: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();

const COMPOSE = 'Compose';
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('cancel')">
    <DialogContent size="lg" destructive data-testid="docker-edit-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('docker.dialog.recreateConfirm.title') }}</DialogTitle>
        <DialogDescription>{{ t('docker.dialog.recreateConfirm.body') }}</DialogDescription>
      </DialogHeader>

      <DialogBody>
      <EditPendingSummary :changes="changes" />

      <section class="flex flex-col gap-1" data-testid="docker-edit-lost">
        <h4 class="text-kira-sm uppercase tracking-wider text-muted-foreground">{{ t('docker.dialog.recreateConfirm.lost.title') }}</h4>
        <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5">
          <li data-testid="docker-edit-lost-layer">{{ t('docker.dialog.recreateConfirm.lostLayer.body') }}</li>
          <li v-for="v in spec.anonymousVolumes" :key="v.name" class="break-all" data-testid="docker-edit-lost-volume">
            <CatalogText k="docker.dialog.recreateConfirm.lostVolume.body">
              <template #name><span class="font-data">{{ v.name }}</span></template>
              <template #destination><span class="font-data">{{ v.destination }}</span></template>
            </CatalogText>
          </li>
          <li>{{ t('docker.dialog.recreateConfirm.lostLogs.body') }}</li>
          <li>{{ t('docker.dialog.recreateConfirm.lostId.body') }}</li>
        </ul>
      </section>

      <section class="flex flex-col gap-1" data-testid="docker-edit-kept">
        <h4 class="text-kira-sm uppercase tracking-wider text-muted-foreground">{{ t('docker.dialog.recreateConfirm.kept.title') }}</h4>
        <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5">
          <li>{{ t('docker.dialog.recreateConfirm.keptBase.body') }}</li>
          <li v-if="spec.preserved.length">{{ t('docker.dialog.recreateConfirm.keptMore.body', { items: spec.preserved.join(', ') }) }}</li>
          <li v-if="spec.state === 'running'">{{ t('docker.dialog.recreateConfirm.restarts.body') }}</li>
          <li v-else>{{ t('docker.dialog.recreateConfirm.staysStopped.body') }}</li>
        </ul>
      </section>

      <Alert v-if="spec.dependents.length" variant="warn" data-testid="docker-edit-dependents">
        <AlertDescription>
          {{ t('docker.dialog.recreateConfirm.dependents.body', { names: spec.dependents.join(', ') }) }}
        </AlertDescription>
      </Alert>
      <Alert v-if="spec.origin === 'compose'" variant="info" data-testid="docker-edit-compose">
        <AlertDescription>
          {{ t('docker.dialog.recreateConfirm.compose.body', { tool: COMPOSE, name: spec.originName }) }}
        </AlertDescription>
      </Alert>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-dialog-dismiss data-testid="docker-edit-cancel" @click="emit('cancel')">{{ t('common.action.cancel.label') }}</Button>
        <Button variant="dialog-danger" size="kira-lg" :disabled="busy" data-testid="docker-edit-confirm" @click="emit('confirm')">
          {{ t('docker.dialog.recreateConfirm.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
