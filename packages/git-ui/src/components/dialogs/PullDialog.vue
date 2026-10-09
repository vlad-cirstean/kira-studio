<script setup lang="ts">
/**
 * `docs/plans/P9.md` §7.3/§7.5's `stashAndCarry` route, pull's side (OQ10/W10) — the confirm step
 * for `OpsState.runPull`'s own `dirtyNonFastForward` blocker, mirroring `CheckoutDialog.vue`'s
 * "a hazard pre-flight sets a pending ref, this dialog renders while it is set, resolving it
 * settles the promise the caller is awaiting" shape exactly, one route simpler: pull's own
 * `PullPreflight.routes` only ever offers `"stashAndCarry"` (there is no pull analogue of
 * "discard" — a merge/rebase cannot be told to just throw the local changes away), so
 * `resolvePullDialog` takes a plain `boolean` rather than a tagged route.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */
import type { PullPreflight } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
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

const pending = computed<PullPreflight | undefined>(() => props.ops.pendingPull.value);
const active = computed(() => pending.value !== undefined);

function cancel(): void {
  props.ops.resolvePullDialog(false);
}

function stashAndCarry(): void {
  props.ops.resolvePullDialog(true);
}
</script>

<template>
  <Dialog v-if="pending" :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent
      :show-close-button="false"
      class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Can't pull — local changes in the way</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-2 overflow-auto px-3 py-2">
        <DialogDescription>
          Pulling with <code>{{ pending.strategy }}</code> would rewrite history here, and your
          working tree has uncommitted changes that would be overwritten.
        </DialogDescription>
        <p class="text-error">
          Stashing them first keeps them safe: your changes are pushed to a stash, the pull runs,
          then — if it can be applied back with no conflict — they are popped back automatically. A
          predicted conflict leaves them stashed instead of forcing a bad pop; nothing is ever
          discarded.
        </p>
      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" data-testid="pull-stash-and-carry" @click="stashAndCarry">
          Stash changes and pull
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
