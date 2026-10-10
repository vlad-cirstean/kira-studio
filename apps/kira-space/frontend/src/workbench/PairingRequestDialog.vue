<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { usePendingDecision } from '@workbench/util/usePendingDecision';

// Shared shell for a pairing prompt PromptHost mounts. Renders nothing while `requestId` is absent;
// Escape and the frame's close hide it (`hide`), only Deny denies. The countdown keys on the
// request id (usePendingDecision), so the queue advancing A to B re-arms Deny focus and the timer.
const props = defineProps<{
  title: string;
  requestId?: string;
  expiresAtMs?: number;
  more: number;
  testidPrefix: string;
}>();
const emit = defineEmits<{ deny: []; approve: []; hide: [] }>();

const { remainingSeconds } = usePendingDecision({
  pendingId: () => props.requestId,
  expiresAtMs: () => props.expiresAtMs,
});
</script>

<template>
  <Dialog v-if="requestId" :open="true" @update:open="(v) => !v && emit('hide')">
    <DialogContent
      :show-close-button="false"
      :data-testid="`${testidPrefix}-dialog`"
      class="flex flex-col p-0 gap-0 w-105 max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="overflow-auto">
        <slot />
        <p class="m-0 text-subtle px-3 pb-2" :data-testid="`${testidPrefix}-expires`">
          Expires in {{ remainingSeconds }}s
        </p>
        <p v-if="more > 0" class="m-0 text-subtle px-3 pb-2" :data-testid="`${testidPrefix}-queue-count`">
          {{ more }} more waiting
        </p>
      </div>

      <DialogFooter>
        <span class="flex items-center gap-1 ml-auto">
          <Button
            ref="denyButton"
            variant="dialog"
            size="kira-lg"
            :data-testid="`${testidPrefix}-deny`"
            @click="emit('deny')"
          >
            Deny
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            :data-testid="`${testidPrefix}-approve`"
            @click="emit('approve')"
          >
            Approve
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
