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
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content.
 */
import type { PullPreflight } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
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
  <KuiDialog v-if="pending" :open="active" title="Can't pull — local changes in the way" @close="cancel">
    <p>
      Pulling with <code>{{ pending.strategy }}</code> would rewrite history here, and your
      working tree has uncommitted changes that would be overwritten.
    </p>
    <p class="kv-dialog-note">
      Stashing them first keeps them safe: your changes are pushed to a stash, the pull runs,
      then — if it can be applied back with no conflict — they are popped back automatically. A
      predicted conflict leaves them stashed instead of forcing a bad pop; nothing is ever
      discarded.
    </p>

    <template #actions>
      <KuiButton variant="primary" data-testid="pull-stash-and-carry" @click="stashAndCarry">
        Stash changes and pull
      </KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}
</style>
