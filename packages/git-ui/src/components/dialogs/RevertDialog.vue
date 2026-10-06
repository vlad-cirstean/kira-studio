<script setup lang="ts">
/**
 * `docs/plans/P6.md` W15: §7.10's confirm step. `OpsState.runRevert` awaits this dialog whenever
 * the preflight is not a clean, non-merge, single-sha revert (`verdict !== "clean"` or a mainline
 * is required) — see that method's own doc comment — so a plain revert of an ordinary commit
 * never opens it at all.
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

const preflight = computed(() => props.ops.pendingRevert.value);
const active = computed(() => preflight.value !== undefined);

const selectedMainline = ref<number | undefined>(undefined);
const noCommit = ref(false);

// A genuinely new revert request (a different `shas` set) resets the choice; a re-preflight for
// the *same* shas — `previewRevertMainline`'s own refresh, triggered by the watch just below —
// must not, or picking a mainline would immediately un-pick itself.
watch(
  () => preflight.value?.shas.join(','),
  () => {
    selectedMainline.value = undefined;
    noCommit.value = false;
  },
);

watch(selectedMainline, (mainline) => {
  if (mainline !== undefined) void props.ops.previewRevertMainline(mainline);
});

const needsMainline = computed(() => (preflight.value?.mainlineRequired.length ?? 0) > 0);
const canConfirm = computed(() => !needsMainline.value || selectedMainline.value !== undefined);
const isMultiSha = computed(() => (preflight.value?.shas.length ?? 0) > 1);

function cancel(): void {
  props.ops.resolveRevertDialog(null);
}

function confirm(): void {
  if (!canConfirm.value) return;
  props.ops.resolveRevertDialog({ mainline: selectedMainline.value, noCommit: noCommit.value });
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent
      :show-close-button="false"
      class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Revert</DialogTitle>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto">
        <DialogDescription>
          Reverting applies the inverse of {{ isMultiSha ? 'each selected commit' : 'this commit' }}
          as a new commit — the original stays in history, so this is safe on branches you've already
          pushed.
        </DialogDescription>

        <p v-if="preflight?.detachedHead" class="kv:text-diff-deleted">
          HEAD is detached: the revert commit will not belong to any branch until you create one.
        </p>

        <template v-if="needsMainline">
          <p>
            This reverts a merge commit — pick which parent's history to treat as the "mainline"
            (§7.10: git cannot guess this for you):
          </p>
          <RadioGroup v-model="selectedMainline">
            <div
              v-for="entry in preflight?.mainlineRequired"
              :key="entry.sha"
              class="kv:my-1 kv:p-1 kv:border kv:border-panel-border kv:rounded-sm"
            >
              <p class="kv:m-0 kv:mb-0.5 kv:font-semibold"><code>{{ entry.sha.slice(0, 7) }}</code></p>
              <Label
                v-for="parent in entry.parents"
                :key="parent.parentNumber"
                class="flex flex-row items-center gap-1 py-0.5"
              >
                <RadioGroupItem :value="parent.parentNumber" />
                Parent {{ parent.parentNumber }} — <code>{{ parent.sha.slice(0, 7) }}</code>
                {{ parent.subject }}
              </Label>
            </div>
          </RadioGroup>
        </template>

        <template v-if="!needsMainline || selectedMainline !== undefined">
          <PreflightPrediction
            v-if="preflight"
            :prediction="preflight.prediction"
            v-model:no-commit="noCommit"
          />

          <p v-if="isMultiSha" class="kv:text-diff-deleted">
            This prediction covers only the first of the {{ preflight?.shas.length }} selected
            commits — the rest may conflict differently.
          </p>
        </template>
      </div>

      <DialogFooter class="justify-end gap-1">
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canConfirm" @click="confirm">
          Revert
        </Button>
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
