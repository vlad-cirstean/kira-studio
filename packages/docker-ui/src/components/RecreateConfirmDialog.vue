<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import type { PendingChange } from '../lib/editDiff';
import type { DockerEditSpec } from '../wire';
import EditPendingSummary from './EditPendingSummary.vue';

defineProps<{ spec: DockerEditSpec; changes: PendingChange[]; busy: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('cancel')">
    <DialogContent class="max-h-[85vh] w-[34rem] max-w-[calc(100vw-2rem)] overflow-auto" data-testid="docker-edit-dialog">
      <DialogHeader>
        <DialogTitle>Recreate container</DialogTitle>
        <DialogDescription>
          The engine cannot change these settings on a container that exists. A new container replaces this one.
        </DialogDescription>
      </DialogHeader>

      <EditPendingSummary :changes="changes" />

      <section class="flex flex-col gap-1" data-testid="docker-edit-lost">
        <h4 class="text-kira-sm uppercase tracking-wider text-muted-foreground">What is lost</h4>
        <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5">
          <li data-testid="docker-edit-lost-layer">Writable layer: files changed inside the container outside volumes.</li>
          <li v-for="v in spec.anonymousVolumes" :key="v.name" class="break-all" data-testid="docker-edit-lost-volume">
            Anonymous volume <span class="font-data">{{ v.name }}</span> at <span class="font-data">{{ v.destination }}</span>: detached, kept as an unused volume.
          </li>
          <li>The old container's logs.</li>
          <li>The container ID changes: open terminals and log views close.</li>
        </ul>
      </section>

      <section class="flex flex-col gap-1" data-testid="docker-edit-kept">
        <h4 class="text-kira-sm uppercase tracking-wider text-muted-foreground">What is kept</h4>
        <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5">
          <li>Name, networks and aliases, named and bind mounts<template v-if="spec.preserved.length">, {{ spec.preserved.join(', ') }}</template>.</li>
          <li v-if="spec.state === 'running'">The container stops, then the new one starts.</li>
          <li v-else>The new container stays stopped.</li>
        </ul>
      </section>

      <Alert v-if="spec.dependents.length" variant="warn" data-testid="docker-edit-dependents">
        <AlertDescription>
          {{ spec.dependents.join(', ') }} share this container's network and lose it until restarted.
        </AlertDescription>
      </Alert>
      <Alert v-if="spec.origin === 'compose'" variant="note" data-testid="docker-edit-compose">
        <AlertDescription>
          Part of Compose project {{ spec.originName }}. Compose will see a different container.
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="docker-edit-cancel" @click="emit('cancel')">Cancel</Button>
        <Button variant="dialog-danger" size="kira-lg" :disabled="busy" data-testid="docker-edit-confirm" @click="emit('confirm')">
          Recreate container
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
