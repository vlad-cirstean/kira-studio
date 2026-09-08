<script setup lang="ts">
/**
 * `docs/plans/P6.md` W15: §7's confirm step, "only when destructive or when pre-flight found a
 * hazard". `OpsState.runCheckout` only ever awaits this dialog for a `"blocked"` verdict (`clean`
 * and `cleanCarry` proceed with no prompt, §7.5 taken literally — see that method's own doc
 * comment) — so this file has nothing to render for either of those and never receives one.
 *
 * `docs/plans/P9.md`: a bare `blockedByTracked` (no untracked block alongside it) also offers
 * `"stashAndCarry"` in `preflight.routes` — the "Stash changes and check out" button below,
 * calling straight back into `resolveCheckoutDialog` exactly like Discard/Cancel do, since
 * `runCheckout`'s own inline handling of that route (not a second dialog) is the rest of the
 * confirm step.
 *
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content.
 */
import type { CheckoutPreflight } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const preflight = computed<CheckoutPreflight | undefined>(() => props.ops.pendingCheckout.value);
const active = computed(() => preflight.value !== undefined);

/** W2's own asserted order — inProgress first (it makes every other remedy moot), then worktree,
 *  then untracked, then tracked — so the *headline* blocker is always the one that actually
 *  explains why nothing else here would have helped either. */
const headline = computed(() => {
  const blockers = preflight.value?.blockers ?? [];
  return (
    blockers.find((b) => b.kind === 'inProgressOperation') ??
    blockers.find((b) => b.kind === 'worktreeConflict') ??
    blockers.find((b) => b.kind === 'blockedByUntracked') ??
    blockers.find((b) => b.kind === 'blockedByTracked')
  );
});

const trackedBlocker = computed(() =>
  preflight.value?.blockers.find((b) => b.kind === 'blockedByTracked'),
);
const canDiscard = computed(() => preflight.value?.routes.includes('discard') ?? false);
const canStashAndCarry = computed(() => preflight.value?.routes.includes('stashAndCarry') ?? false);

function cancel(): void {
  props.ops.resolveCheckoutDialog(null);
}

function discard(): void {
  props.ops.resolveCheckoutDialog({ kind: 'discard' });
}

function stashAndCarry(): void {
  props.ops.resolveCheckoutDialog({ kind: 'stashAndCarry' });
}
</script>

<template>
  <KuiDialog :open="active" :title="`Can't check out ${preflight?.target.name}`" @close="cancel">
    <template v-if="headline?.kind === 'inProgressOperation'">
      <p>An operation is already in progress. Resolve or abort it first.</p>
    </template>

    <template v-else-if="headline?.kind === 'worktreeConflict'">
      <p>
        <code>{{ headline.branch }}</code> is already checked out in another worktree
        (<code>{{ headline.worktreePath }}</code>). Git will not check out the same branch in two
        places at once.
      </p>
    </template>

    <template v-else-if="headline?.kind === 'blockedByUntracked'">
      <p>These untracked files would be overwritten by the checkout:</p>
      <ul class="kv-dialog-file-list">
        <li v-for="path in headline.paths" :key="path"><code>{{ path }}</code></li>
      </ul>
      <p>Move or remove them yourself, then try again — there is no safe way to discard them here.</p>
    </template>

    <template v-else-if="trackedBlocker">
      <p>These local changes would be overwritten by the checkout:</p>
      <ul class="kv-dialog-file-list">
        <li v-for="path in trackedBlocker.paths" :key="path"><code>{{ path }}</code></li>
      </ul>
      <p v-if="canDiscard" class="kv-dialog-note">
        Discard permanently deletes these changes — this cannot be undone.
        <template v-if="canStashAndCarry">Stashing them instead keeps them, safely.</template>
      </p>
    </template>

    <template #actions>
      <KuiButton v-if="canStashAndCarry" variant="primary" @click="stashAndCarry">
        Stash changes and check out
      </KuiButton>
      <KuiButton v-if="canDiscard" variant="danger" @click="discard">
        Discard changes and check out
      </KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-file-list {
  max-height: 160px;
  overflow-y: auto;
  margin: var(--kv-space-2) 0;
  padding-left: var(--kv-space-4);
  font-family: var(--kv-mono-font-family);
  font-size: 0.9em;
}

.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}
</style>
