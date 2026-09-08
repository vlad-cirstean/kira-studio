<script setup lang="ts">
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
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content. The plain-`--force` confirm button stays inside the `<details>` body
 * (in the default slot) rather than moving to `<template #actions>`, since it belongs beside its
 * own disclosure and acknowledgement checkbox, not beside the lease/Cancel pair.
 */
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const pending = computed(() => props.ops.pendingForcePush.value);
const active = computed(() => pending.value !== undefined);

const typedBranch = ref('');
const understandPlain = ref(false);

watch(pending, () => {
  typedBranch.value = '';
  understandPlain.value = false;
});

const protectedBy = computed(() => pending.value?.preflight.protectedBy ?? null);
const isProtected = computed(() => protectedBy.value !== null);
const confirmToken = computed(() => (isProtected.value ? typedBranch.value : undefined));
const branchNameMatches = computed(
  () => !isProtected.value || typedBranch.value === pending.value?.branch,
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
  <KuiDialog
    v-if="pending"
    :open="active"
    :title="`Force push ${pending.branch} to ${pending.remote}?`"
    @close="cancel"
  >
    <p>
      This will overwrite <code>{{ pending.remote }}/{{ pending.branch }}</code>, currently at
      <code>{{ shortSha(pending.preflight.remoteTip) }}</code>.
      <template v-if="pending.preflight.behind > 0">
        It is {{ pending.preflight.behind }} commit{{ pending.preflight.behind === 1 ? '' : 's' }}
        ahead of what you last saw.
      </template>
    </p>

    <p v-if="protectedBy" class="kv-dialog-error">
      <code>{{ pending.branch }}</code> matches your protected pattern
      <code>{{ protectedBy }}</code>. Type the branch name to confirm.
    </p>
    <label v-if="protectedBy" class="kv-dialog-field">
      Branch name
      <input
        v-model="typedBranch"
        type="text"
        autofocus
        :placeholder="pending.branch"
        data-testid="force-push-confirm-branch"
      />
    </label>

    <details class="kv-force-push-plain">
      <summary>Use plain <code>--force</code> instead</summary>
      <p class="kv-dialog-error">
        This skips the lease check entirely — it will overwrite the remote branch even if someone
        else has pushed to it since the lease's own tip was read, with no protection against
        discarding their work.
      </p>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input v-model="understandPlain" type="checkbox" data-testid="force-push-plain-ack" />
        I understand — overwrite the remote branch without checking for other pushes
      </label>
      <div class="kv-force-push-plain-actions">
        <KuiButton
          variant="danger"
          :disabled="!canConfirmPlain"
          data-testid="force-push-confirm-plain"
          @click="confirmPlain"
        >
          Force push (plain --force)
        </KuiButton>
      </div>
    </details>

    <template #actions>
      <KuiButton
        variant="primary"
        :disabled="!canConfirmLease"
        data-testid="force-push-confirm-lease"
        @click="confirmLease"
      >
        Force push (with lease)
      </KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-error {
  color: var(--kv-diff-deleted-fg);
  margin: var(--kv-space-1) 0;
}

.kv-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-1);
  margin: var(--kv-space-2) 0;
}

.kv-dialog-field--inline {
  flex-direction: row;
  align-items: center;
}

.kv-dialog-field input[type='text'] {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-force-push-plain {
  margin-top: var(--kv-space-3);
  padding-top: var(--kv-space-2);
  border-top: 1px solid var(--kv-panel-border);
}

.kv-force-push-plain summary {
  cursor: pointer;
  color: var(--kv-description-fg);
}

.kv-force-push-plain-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--kv-space-2);
}
</style>
