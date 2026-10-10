<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
/**
 * G-UX (item 3): "when checking out a branch that advanced, ask if I want to pull it too" —
 * `OpsState.runCheckout`'s own post-switch confirm step (`#maybePromptPostCheckoutPull`), mirroring
 * `PullDialog.vue`'s "a pending ref set by the state class, this dialog renders while it is set,
 * resolving it settles the promise the caller is awaiting" shape, one route simpler: there is only
 * ever Pull now / Not now, never a hazard to describe.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now.
 */
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { computed } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const pending = computed(() => props.ops.pendingPostCheckoutPull.value);
const active = computed(() => pending.value !== undefined);

function notNow(): void {
  props.ops.resolvePostCheckoutPullDialog(false);
}

function pullNow(): void {
  props.ops.resolvePostCheckoutPullDialog(true);
}
</script>

<template>
  <Dialog v-if="pending" :open="active" @update:open="(v) => !v && notNow()">
    <DialogContent
      :show-close-button="false"
      class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Pull the latest changes?</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <DialogDescription>
          <strong>{{ pending.branch }}</strong> is {{ pending.behind }}
          {{ pending.behind === 1 ? 'commit' : 'commits' }} behind
          <code class="font-data">{{ pending.upstreamShortName }}</code> — pull now?
        </DialogDescription>
      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" data-testid="post-checkout-pull-not-now" @click="notNow">
          Not now
        </Button>
        <Button variant="dialog-primary" size="kira-lg" data-testid="post-checkout-pull-now" @click="pullNow">
          Pull now
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
