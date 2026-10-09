<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
/**
 * `docs/plans/P8.md` W17: the confirm step for `OpsState.runForcePush` — mirrors
 * `CheckoutDialog.vue`/`RevertDialog.vue`'s own "a hazard pre-flight sets a pending ref, this
 * dialog renders while it is set, resolving it settles the promise the caller is awaiting"
 * shape, `pendingForcePush`/`resolveForcePushDialog` playing the same roles as
 * `pendingCheckout`/`resolveCheckoutDialog`.
 *
 * Two escalating confirmations, per §7.4/D48/D52:
 *  - The default path is the lease (`--force-with-lease --force-if-includes`) — safe against
 *    anything pushed since `remoteTip` was read, whether or not this session ever fetched it.
 *    On a protected branch (`preflight.protectedBy` non-null) it additionally requires typing
 *    the branch name back, D52's own friction for the common protected case.
 *  - Plain `--force` bypasses the lease entirely and is behind its own, separately-worded
 *    confirmation (a `<details>` disclosure, collapsed by default) — needed on top of, not
 *    instead of, the typed branch name when the branch is also protected.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content. The plain-`--force` confirm button stays inside the
 * `<details>` body (in the default slot) rather than moving to `DialogFooter`, since it belongs
 * beside its own disclosure and acknowledgement checkbox, not beside the lease/Cancel pair.
 */
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const pending = computed(() => props.ops.pendingForcePush.value);
const active = computed(() => pending.value !== undefined);
// P131 Part 1 §6.2: biome's noLabelWithoutControl can't see through a nested shadcn `Input`
// component to the native `<input>` it renders, unlike the raw `<input>` this label used to wrap
// directly -- an explicit for/id pair keeps the same association, verifiably.
const branchNameId = useId();

const typedBranch = ref('');
const understandPlain = ref(false);

watch(pending, () => {
  typedBranch.value = '';
  understandPlain.value = false;
});

const protectedBy = computed(() => pending.value?.preflight.protectedBy ?? null);
const isProtected = computed(() => protectedBy.value !== null);
// F2 (P108 Part 16 review): the backend's ConfirmToken check (gitsession.RunRemote) gates on the
// resolved UPSTREAM branch name, not pending.branch's LOCAL one — a stacked/renamed branch can
// track a differently-named protected upstream. Comparing/sending the local name here made the
// gate impossible to ever satisfy in that case.
const resolvedBranch = computed(
  () => pending.value?.preflight.resolvedBranch ?? pending.value?.branch ?? '',
);
const confirmToken = computed(() => (isProtected.value ? typedBranch.value : undefined));
const branchNameMatches = computed(
  () => !isProtected.value || typedBranch.value === resolvedBranch.value,
);
const canConfirmLease = computed(() => branchNameMatches.value);
const canConfirmPlain = computed(() => branchNameMatches.value && understandPlain.value);

function shortSha(sha: string | null): string {
  return sha === null ? 'nothing yet' : sha.slice(0, 7);
}

function cancel(): void {
  props.ops.resolveForcePushDialog(null);
}

function confirmLease(): void {
  if (!canConfirmLease.value) return;
  props.ops.resolveForcePushDialog({ plain: false, confirmToken: confirmToken.value });
}

function confirmPlain(): void {
  if (!canConfirmPlain.value) return;
  props.ops.resolveForcePushDialog({ plain: true, confirmToken: confirmToken.value });
}
</script>

<template>
  <Dialog v-if="pending" :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent
      :show-close-button="false"
      class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Force push {{ pending.branch }} to {{ pending.remote }}?</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-2 overflow-auto px-3 py-2">
        <DialogDescription>
          This will overwrite <code>{{ pending.remote }}/{{ resolvedBranch }}</code>, currently at
          <code>{{ shortSha(pending.preflight.remoteTip) }}</code>.
          <template v-if="pending.preflight.behind > 0">
            It is {{ pending.preflight.behind }} commit{{ pending.preflight.behind === 1 ? '' : 's' }}
            ahead of what you last saw.
          </template>
        </DialogDescription>

        <p v-if="protectedBy" class="text-error">
          <code>{{ resolvedBranch }}</code> matches your protected pattern
          <code>{{ protectedBy }}</code>. Type the branch name to confirm.
        </p>
        <label v-if="protectedBy" :for="branchNameId" class="flex flex-col gap-0.5">
          Branch name
          <Input
            :id="branchNameId"
            v-model="typedBranch"
            type="text"
            :placeholder="resolvedBranch"
            size="kira"
            class="w-full"
            data-testid="force-push-confirm-branch"
          />
        </label>

        <details class="mt-2 pt-1 border-t border-border">
          <summary class="cursor-pointer text-muted-foreground">Use plain <code>--force</code> instead</summary>
          <p class="text-error">
            This skips the lease check entirely — it will overwrite the remote branch even if someone
            else has pushed to it since the lease's own tip was read, with no protection against
            discarding their work.
          </p>
          <Label class="flex flex-row items-center gap-1">
            <Checkbox v-model="understandPlain" data-testid="force-push-plain-ack" />
            I understand — overwrite the remote branch without checking for other pushes
          </Label>
          <div class="flex justify-end mt-1">
            <Button
              variant="dialog-danger"
              size="kira-lg"
              :disabled="!canConfirmPlain"
              data-testid="force-push-confirm-plain"
              @click="confirmPlain"
            >
              Force push (plain --force)
            </Button>
          </div>
        </details>
      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!canConfirmLease"
          data-testid="force-push-confirm-lease"
          @click="confirmLease"
        >
          Force push (with lease)
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
