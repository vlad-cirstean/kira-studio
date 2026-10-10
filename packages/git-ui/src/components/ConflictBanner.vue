<script setup lang="ts">
/**
 * `docs/plans/P6.md` W16: §7.11's "make it impossible to miss" — flagged in this phase's own plan
 * as needing extra care, so this file is deliberately conservative: it reads nothing but
 * `ops.statusSummary.value.inProgress` (the one place `classifyInProgress`'s precedence table
 * already lives, in `core`), and touches no state of its own beyond which of its three actions is
 * mid-request.
 *
 * Persistent, above the graph, present for exactly as long as `inProgress !== null` — reactive
 * through `OpsState.refreshStatus`'s own `repo.changed` subscription (W12), which is what makes
 * "Continue re-enables without a manual refresh once the last conflict is staged" true: the
 * watcher already fires on an `index` touch (`git add` is exactly that), `refreshStatus` re-reads
 * `unmergedCount`, and this component is a plain `computed` over the result — there is nothing
 * here to explicitly "recheck".
 *
 * `role="status"`, not `role="alert"` (W20's own reasoning, restated here since it is easy to get
 * backwards): `alert` is for a message that appears and is gone: an assertive region that *stays
 * on screen* for the length of an entire git operation is a screen-reader trap, re-announcing
 * itself on every incidental change unless the AT's own heuristics happen to suppress it. `status`
 * still announces on appearance (the whole point) without demanding attention indefinitely.
 */
import { describeInProgress } from '@kira/git-core';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import type { OpsState } from '../state/ops.ts';

const props = defineProps<{
  ops: OpsState;
}>();

const inProgress = computed(() => props.ops.statusSummary.value?.inProgress ?? null);
const busyAction = ref<'continue' | 'skip' | 'abort' | undefined>(undefined);

const CONTINUE_REASON_ID = 'git-conflict-continue-reason';

async function onContinue(): Promise<void> {
  if (busyAction.value) return;
  busyAction.value = 'continue';
  try {
    await props.ops.continueOp();
  } finally {
    busyAction.value = undefined;
  }
}

async function onAbort(): Promise<void> {
  if (busyAction.value) return;
  busyAction.value = 'abort';
  try {
    await props.ops.abortOp();
  } finally {
    busyAction.value = undefined;
  }
}

/** `docs/plans/P10.md` W13, §7.11's third sequencer verb — rendered only when `canSkip` is true
 *  (cherry-pick and revert only, probe 6), the same gate `core`'s own `InProgressOperation.canSkip`
 *  already computes. */
async function onSkip(): Promise<void> {
  if (busyAction.value) return;
  busyAction.value = 'skip';
  try {
    await props.ops.skipOp();
  } finally {
    busyAction.value = undefined;
  }
}

const PATH_DISPLAY_CAP = 20;
</script>

<template>
  <!-- W20: an opaque Alert surface: a translucent modal-backdrop scrim fails
       contrast over a light theme. -->
  <div v-if="inProgress" class="shrink-0 p-1.5">
  <Alert
    variant="warn"
    role="status"
    data-testid="conflict-banner"
  >
    <div class="flex items-center gap-1">
      <CodiconIcon name="warning" :size="16" />
      <span>{{ describeInProgress(inProgress) }}</span>
      <span v-if="inProgress.unmergedCount > 0" class="text-muted-foreground text-kira-sm">
        {{ inProgress.unmergedCount }} unresolved {{ inProgress.unmergedCount === 1 ? "file" : "files" }}
      </span>

      <span class="flex-1"></span>

      <Button
        v-if="inProgress.canContinue"
        variant="toolbar"
        size="kira"
        :disabled="inProgress.unmergedCount > 0 || busyAction !== undefined"
        :aria-describedby="inProgress.unmergedCount > 0 ? CONTINUE_REASON_ID : undefined"
        @click="onContinue"
      >
        Continue
      </Button>
      <Button
        v-if="inProgress.canSkip"
        variant="toolbar"
        size="kira"
        :disabled="busyAction !== undefined"
        @click="onSkip"
      >
        Skip
      </Button>
      <Button
        v-if="inProgress.canAbort"
        variant="danger"
        size="kira"
        :disabled="busyAction !== undefined"
        @click="onAbort"
      >
        Abort
      </Button>
    </div>

    <p
      v-if="inProgress.unmergedCount > 0"
      :id="CONTINUE_REASON_ID"
      class="mt-0.5 text-kira-sm text-muted-foreground"
    >
      Resolve the remaining {{ inProgress.unmergedCount }}
      {{ inProgress.unmergedCount === 1 ? "file" : "files" }} in your own editor and stage them,
      then Continue{{ inProgress.canSkip ? ", or Skip this commit and move on." : "." }}
    </p>
    <p v-else-if="inProgress.canSkip" class="mt-0.5 text-kira-sm text-muted-foreground">
      No conflicts remain. Continue to commit this change, or Skip if it is already present.
    </p>

    <ul
      v-if="inProgress.conflictedPaths.length > 0"
      class="mt-0.5 pl-3 max-h-20 overflow-y-auto font-data text-kira-sm"
    >
      <li v-for="path in inProgress.conflictedPaths.slice(0, PATH_DISPLAY_CAP)" :key="path">
        <code class="font-data">{{ path }}</code>
      </li>
      <li
        v-if="inProgress.conflictedPaths.length > PATH_DISPLAY_CAP"
        class="text-muted-foreground"
      >
        +{{ inProgress.conflictedPaths.length - PATH_DISPLAY_CAP }} more
      </li>
    </ul>
  </Alert>
  </div>
</template>
