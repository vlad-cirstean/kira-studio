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

    <p v-if="preflight?.detachedHead" class="kv-dialog-note">
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
        class="kv-revert-mainline-group"
      >
        <p class="kv-revert-mainline-sha"><code>{{ entry.sha.slice(0, 7) }}</code></p>
        <label v-for="parent in entry.parents" :key="parent.parentNumber" class="kv-revert-parent">
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
        class="kv-revert-prediction kv-revert-prediction--clean"
      >
        No conflicts predicted.
      </div>
      <div
        v-else-if="preflight?.prediction.kind === 'conflicts'"
        class="kv-revert-prediction kv-revert-prediction--conflict"
      >
        <p>This will likely conflict in:</p>
        <ul class="kv-dialog-file-list">
          <li v-for="path in preflight.prediction.paths" :key="path"><code>{{ path }}</code></li>
        </ul>
        <label class="kv-revert-no-commit">
          <input type="checkbox" v-model="noCommit" />
          Stop before committing (<code>--no-commit</code>), so I can resolve first
        </label>
      </div>
      <div v-else-if="preflight?.prediction.kind === 'unknown'" class="kv-revert-prediction">
        Couldn't predict the outcome: {{ preflight.prediction.reason }}
      </div>

      <p v-if="isMultiSha" class="kv-dialog-note">
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

<style scoped>
.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}

.kv-dialog-file-list {
  max-height: 160px;
  overflow-y: auto;
  margin: var(--kv-s-2) 0;
  padding-left: var(--kv-s-5);
  font-family: var(--kv-mono-font-family);
  font-size: 0.9em;
}

.kv-revert-mainline-group {
  margin: var(--kv-s-2) 0;
  padding: var(--kv-s-2);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
}

.kv-revert-mainline-sha {
  margin: 0 0 var(--kv-s-1);
  font-weight: 600;
}

.kv-revert-parent {
  display: block;
  padding: var(--kv-s-1) 0;
}

.kv-revert-prediction {
  margin: var(--kv-s-4) 0;
}

.kv-revert-prediction--clean {
  color: var(--kv-diff-added-fg);
}

.kv-revert-no-commit {
  display: block;
  margin-top: var(--kv-s-2);
}
</style>
