<script setup lang="ts">
/**
 * `docs/plans/P10.md` W12: §7.13's confirm step — a near-sibling of `RevertDialog.vue`, opened by
 * `OpsState.runCherryPick` whenever the pre-flight is not a clean, non-merge, not-already-applied
 * single pick (that method's own doc comment). One addition revert has no need of: the non-
 * blocking `alreadyApplied` advisory (probe 6) — it never sets a blocker or changes `verdict`, so
 * it is rendered as its own note rather than folded into the blocker list below.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Label } from '@theme/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import PreflightPrediction from './PreflightPrediction.vue';

const props = defineProps<{ ops: OpsState }>();

const preflight = computed(() => props.ops.pendingCherryPick.value);
const active = computed(() => preflight.value !== undefined);

const selectedMainline = ref<number | undefined>(undefined);
const noCommit = ref(false);

// A genuinely new cherry-pick request (a different sha) resets the choice; a re-preflight for
// the *same* sha — `previewCherryPickMainline`'s own refresh, triggered by the watch just below
// — must not, or picking a mainline would immediately un-pick itself.
watch(
  () => preflight.value?.sha,
  () => {
    selectedMainline.value = undefined;
    noCommit.value = false;
  },
);

watch(selectedMainline, (mainline) => {
  if (mainline !== undefined) void props.ops.previewCherryPickMainline(mainline);
});

const needsMainline = computed(() => (preflight.value?.mainlineRequired.length ?? 0) > 0);
// `classifyCherryPick` files `mainlineRequired` as a `CherryPickBlocker` alongside the real,
// nothing-else-to-do refusals (probe 7's set-intersection blockers, plus the in-progress gate) —
// but unlike those, it has its own dedicated, non-blocking resolution right here (the radio group
// below), the same way `RevertDialog.vue`'s own `needsMainline` never waits on a generic blocker
// list at all. Filtered out here so picking a mainline stays reachable on its own: left in,
// `hasBlocker` would be permanently true the moment `needsMainline` is, the radio group would
// never render (`v-if="!hasBlocker && needsMainline"` below), and a merge commit's cherry-pick
// could never be confirmed.
const blockers = computed(
  () => preflight.value?.blockers.filter((b) => b.kind !== 'mainlineRequired') ?? [],
);
// Every remaining blocker is a real git refusal — unlike `RevertPreflight`'s advisory
// `dirtyWorktree`, there is no route past any of these short of changing the working tree or
// resolving the other operation first, so Confirm stays disabled while any is present.
const hasBlocker = computed(() => blockers.value.length > 0);
const canConfirm = computed(
  () => !hasBlocker.value && (!needsMainline.value || selectedMainline.value !== undefined),
);

function cancel(): void {
  props.ops.resolveCherryPickDialog(null);
}

function confirm(): void {
  if (!canConfirm.value) return;
  props.ops.resolveCherryPickDialog({
    mainline: selectedMainline.value,
    noCommit: noCommit.value,
  });
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent
      :show-close-button="false"
      class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Cherry-pick</DialogTitle>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto">
        <DialogDescription>
          Applies this commit's changes here as a new commit — the original stays where it is.
        </DialogDescription>

        <p v-if="preflight?.detachedHead" class="kv:text-diff-deleted">
          HEAD is detached: the new commit will not belong to any branch until you create one.
        </p>

        <p v-if="preflight?.alreadyApplied" class="kv:text-diff-deleted">
          This change already appears in this branch's history; the pick will probably be empty.
        </p>

        <template v-if="hasBlocker">
          <div v-for="(blocker, i) in blockers" :key="i" class="kv:my-1">
            <template v-if="blocker.kind === 'inProgressOperation'">
              <p>An operation is already in progress. Resolve or abort it first.</p>
            </template>
            <template v-else-if="blocker.kind === 'stagedChanges'">
              <p>Staged changes would be overwritten by this pick — commit or unstage them first:</p>
              <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-base">
                <li v-for="path in blocker.paths" :key="path"><code>{{ path }}</code></li>
              </ul>
            </template>
            <template v-else-if="blocker.kind === 'localChangesWouldBeOverwritten'">
              <p>These local changes would be overwritten by this pick:</p>
              <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-base">
                <li v-for="path in blocker.paths" :key="path"><code>{{ path }}</code></li>
              </ul>
            </template>
            <template v-else-if="blocker.kind === 'untrackedWouldBeOverwritten'">
              <p>These untracked files would be overwritten by this pick:</p>
              <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-base">
                <li v-for="path in blocker.paths" :key="path"><code>{{ path }}</code></li>
              </ul>
            </template>
          </div>
        </template>

        <template v-if="!hasBlocker && needsMainline">
          <p>
            This picks a merge commit — pick which parent's history to treat as the "mainline"
            (probe 8: git cannot guess this for you):
          </p>
          <RadioGroup v-model="selectedMainline">
            <div
              v-for="entry in preflight?.mainlineRequired"
              :key="entry.parentNumber"
              class="kv:py-0.5"
            >
              <Label class="flex flex-row items-center gap-1">
                <RadioGroupItem :value="entry.parentNumber" />
                Parent {{ entry.parentNumber }} — <code>{{ entry.sha.slice(0, 7) }}</code>
                {{ entry.subject }}
              </Label>
            </div>
          </RadioGroup>
        </template>

        <template v-if="!hasBlocker && (!needsMainline || selectedMainline !== undefined)">
          <PreflightPrediction
            v-if="preflight"
            :prediction="preflight.prediction"
            v-model:no-commit="noCommit"
          />
        </template>
      </div>

      <DialogFooter class="justify-end gap-1">
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!canConfirm"
          data-testid="cherry-pick-confirm"
          @click="confirm"
        >
          Cherry-pick
        </Button>
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
