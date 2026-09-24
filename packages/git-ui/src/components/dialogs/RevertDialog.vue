<script setup lang="ts">
/**
 * `docs/plans/P6.md` W15: §7.10's confirm step. `OpsState.runRevert` awaits this dialog whenever
 * the preflight is not a clean, non-merge, single-sha revert (`verdict !== "clean"` or a mainline
 * is required) — see that method's own doc comment — so a plain revert of an ordinary commit
 * never opens it at all.
 *
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content. The W20 accessibility-contrast fix that used to live here as a
 * `.kv-modal-button--primary` override is no longer needed: `KuiButton`'s own `primary` variant
 * already carries adequate contrast in `@kira/kira-ui`'s theme.
 */
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

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
  <KuiDialog :open="active" title="Revert" @close="cancel">
    <p>
      Reverting applies the inverse of {{ isMultiSha ? 'each selected commit' : 'this commit' }}
      as a new commit — the original stays in history, so this is safe on branches you've already
      pushed.
    </p>

    <p v-if="preflight?.detachedHead" class="kv:text-diff-deleted">
      HEAD is detached: the revert commit will not belong to any branch until you create one.
    </p>

    <template v-if="needsMainline">
      <p>
        This reverts a merge commit — pick which parent's history to treat as the "mainline"
        (§7.10: git cannot guess this for you):
      </p>
      <div
        v-for="entry in preflight?.mainlineRequired"
        :key="entry.sha"
        class="kv:my-1 kv:p-1 kv:border kv:border-panel-border kv:rounded-sm"
      >
        <p class="kv:m-0 kv:mb-0.5 kv:font-semibold"><code>{{ entry.sha.slice(0, 7) }}</code></p>
        <label
          v-for="parent in entry.parents"
          :key="parent.parentNumber"
          class="kv:block kv:py-0.5"
        >
          <input
            type="radio"
            name="kv-revert-mainline"
            :value="parent.parentNumber"
            v-model="selectedMainline"
          />
          Parent {{ parent.parentNumber }} — <code>{{ parent.sha.slice(0, 7) }}</code>
          {{ parent.subject }}
        </label>
      </div>
    </template>

    <template v-if="!needsMainline || selectedMainline !== undefined">
      <div
        v-if="preflight?.prediction.kind === 'clean'"
        class="kv:my-2 kv:text-diff-added"
      >
        No conflicts predicted.
      </div>
      <div
        v-else-if="preflight?.prediction.kind === 'conflicts'"
        class="kv:my-2"
      >
        <p>This will likely conflict in:</p>
        <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-sm">
          <li v-for="path in preflight.prediction.paths" :key="path"><code>{{ path }}</code></li>
        </ul>
        <label class="kv:block kv:mt-1">
          <input type="checkbox" v-model="noCommit" />
          Stop before committing (<code>--no-commit</code>), so I can resolve first
        </label>
      </div>
      <div v-else-if="preflight?.prediction.kind === 'unknown'" class="kv:my-2">
        Couldn't predict the outcome: {{ preflight.prediction.reason }}
      </div>

      <p v-if="isMultiSha" class="kv:text-diff-deleted">
        This prediction covers only the first of the {{ preflight?.shas.length }} selected
        commits — the rest may conflict differently.
      </p>
    </template>

    <template #actions>
      <KuiButton variant="primary" :disabled="!canConfirm" @click="confirm">Revert</KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>
