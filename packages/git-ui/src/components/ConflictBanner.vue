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
import { KuiButton } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { OpsState } from '../state/ops.ts';

const props = defineProps<{
  ops: OpsState;
  writeCapability: boolean;
  resolveConflictEnabled: boolean;
  resolveConflict: (path: string) => Promise<void>;
}>();

const inProgress = computed(() => props.ops.statusSummary.value?.inProgress ?? null);
const busyAction = ref<'resolve' | 'continue' | 'skip' | 'abort' | undefined>(undefined);

const CONTINUE_REASON_ID = 'kv-conflict-continue-reason';

async function onResolve(): Promise<void> {
  const op = inProgress.value;
  const path = op?.conflictedPaths[0];
  if (!path || busyAction.value) return;
  busyAction.value = 'resolve';
  try {
    await props.resolveConflict(path);
  } finally {
    busyAction.value = undefined;
  }
}

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
  <!-- W20: `bg-panel`, not `--kv-overlay-bg` — that token is a translucent modal-backdrop scrim,
       meant to sit behind an opaque dialog, not host text of its own; over a light theme it fails
       contrast against this banner's own text (axe's color-contrast scan, vscode-light/
       high-contrast-light). This is persistent chrome, so it gets an opaque panel background. -->
  <div
    v-if="inProgress"
    class="kv:shrink-0 kv:py-1 kv:px-2 kv:bg-panel kv:border-b kv:border-panel-border"
    role="status"
    data-testid="conflict-banner"
  >
    <div class="kv:flex kv:items-center kv:gap-1">
      <span
        class="codicon codicon-warning kv:text-diff-modified"
        aria-hidden="true"
      ></span>
      <span class="kv:font-semibold">{{ describeInProgress(inProgress) }}</span>
      <span v-if="inProgress.unmergedCount > 0" class="kv:text-muted-foreground kv:text-sm">
        {{ inProgress.unmergedCount }} unresolved {{ inProgress.unmergedCount === 1 ? "file" : "files" }}
      </span>

      <span class="kv:flex-1"></span>

      <KuiButton
        v-if="resolveConflictEnabled"
        :disabled="inProgress.unmergedCount === 0 || busyAction !== undefined"
        @click="onResolve"
      >
        Resolve in VS Code
      </KuiButton>
      <KuiButton
        v-if="writeCapability && inProgress.canContinue"
        :disabled="inProgress.unmergedCount > 0 || busyAction !== undefined"
        :aria-describedby="inProgress.unmergedCount > 0 ? CONTINUE_REASON_ID : undefined"
        @click="onContinue"
      >
        Continue
      </KuiButton>
      <KuiButton
        v-if="writeCapability && inProgress.canSkip"
        :disabled="busyAction !== undefined"
        @click="onSkip"
      >
        Skip
      </KuiButton>
      <KuiButton
        v-if="writeCapability && inProgress.canAbort"
        variant="danger"
        :disabled="busyAction !== undefined"
        @click="onAbort"
      >
        Abort
      </KuiButton>
    </div>

    <p
      v-if="inProgress.unmergedCount > 0 && resolveConflictEnabled"
      :id="CONTINUE_REASON_ID"
      class="kv:mt-0.5 kv:text-xs kv:text-muted-foreground"
    >
      Resolve the remaining {{ inProgress.unmergedCount }}
      {{ inProgress.unmergedCount === 1 ? "file" : "files" }} first, then Continue{{
        inProgress.canSkip ? ", or Skip this commit and move on." : "."
      }}
    </p>
    <p
      v-else-if="inProgress.unmergedCount > 0"
      :id="CONTINUE_REASON_ID"
      class="kv:mt-0.5 kv:text-xs kv:text-muted-foreground"
    >
      Resolve the remaining {{ inProgress.unmergedCount }}
      {{ inProgress.unmergedCount === 1 ? "file" : "files" }} in your own editor and stage them,
      then Continue{{ inProgress.canSkip ? ", or Skip this commit and move on." : "." }}
    </p>
    <p v-else-if="inProgress.canSkip" class="kv:mt-0.5 kv:text-xs kv:text-muted-foreground">
      No conflicts remain. Continue to commit this change, or Skip if it is already present.
    </p>

    <ul
      v-if="inProgress.conflictedPaths.length > 0"
      class="kv:mt-0.5 kv:pl-3 kv:max-h-20 kv:overflow-y-auto kv:font-data kv:text-xs"
    >
      <li v-for="path in inProgress.conflictedPaths.slice(0, PATH_DISPLAY_CAP)" :key="path">
        <code>{{ path }}</code>
      </li>
      <li
        v-if="inProgress.conflictedPaths.length > PATH_DISPLAY_CAP"
        class="kv:text-muted-foreground"
      >
        +{{ inProgress.conflictedPaths.length - PATH_DISPLAY_CAP }} more
      </li>
    </ul>
  </div>
</template>
