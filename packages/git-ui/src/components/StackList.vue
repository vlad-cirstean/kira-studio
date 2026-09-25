<script setup lang="ts">
/**
 * G26 D3/F13/F14: `BranchPicker.vue`'s Stacks tab — one sub-list per `StackSummary`, rows
 * pre-order bottom-to-top with `depth`-driven indent (D3), a PR badge and track text reused
 * verbatim from `PrState.byBranch`/`RefRow` (F13/F14), a stale chip, and a header "Restack" button
 * per stack. Row-level "Set stack parent…"/"Remove from stack" mirror `WorktreeList.vue`'s own
 * "this component has nowhere of its own to do X" shape: both EMIT the intent for `App.vue` to
 * open `StackDialog.vue` with, rather than this file owning a second dialog. The Restack button
 * does the same — `StackDialog.vue` is the one place the plan/blockers/progress actually render.
 *
 * P77 §11: `stacks`/`orphans` are already filtered/capped by `pickerModel.ts` (each stack group
 * carries its own already-`StackSummary`, so the per-stack header's "Restack" target/`needsRestack`
 * gate reads `group.summary` directly rather than a second, unfiltered lookup) — this component no
 * longer reads `stack.stacks.value`/`stack.orphans.value` for rendering, and no longer needs the
 * `stack` prop at all (nothing else in this file ever read it).
 */
import type { StackBranch } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { PickerList, PickerStackGroup } from './pickerModel.ts';
import RefSectionHeader from './RefSectionHeader.vue';
import ShowMoreButton from './ShowMoreButton.vue';
import { buildOrphanRows, buildStackRows, prBadgeLabel, type StackRow } from './stackListModel.ts';

const props = defineProps<{
  stacks: PickerList<PickerStackGroup>;
  orphans: PickerList<StackBranch>;
  ops: OpsState;
  /** G24 D9's own branch-tip badge — optional so a caller with nothing to show yet gets a
   *  plain, badge-free list (mirrors `BranchPicker.vue`'s own `pr` prop). */
  pr?: PrState;
  /** C10 §4.2/§4.3: `false` under the native read-only graph — hides Restack/Set stack parent/
   *  Remove from stack, all writes (`stackSet`/`stack.restack`), the same fate the row-menu
   *  precedent (`buildReadOnlyRefMenu`) gives the identical actions reached from a ref's own
   *  context menu. The list itself (base/branch/PR/track/stale) stays visible — a read. */
  writeCapability: boolean;
  /** P74 §3.3 — see `BranchPicker.vue`'s own doc comment on these two props, threaded straight
   *  through from `AppToolbar.vue`. */
  openExternalCapability: boolean;
  openPullRequest: (number: number) => void;
  /** P77 §6.3: raises this tab's own cap — see `TagList.vue`'s own doc comment on this prop.
   *  `stacks`/`orphans` share one `capSteps` key (`pickerModel.ts`'s own `capFor('stacks')`), so
   *  one button raises both. */
  showMore: () => void;
  /** P77 §7.3 — see `TagList.vue`'s own doc comment on this prop. */
  focusedRowId?: string;
}>();

const emit = defineEmits<{
  (e: 'open-restack-dialog', branch: string): void;
  (e: 'open-set-parent-dialog', branch: string): void;
}>();

function byBranchMap() {
  return props.pr?.byBranch.value ?? new Map();
}

function rowsFor(branches: readonly StackBranch[]): StackRow[] {
  // buildStackRows takes a whole StackSummary; this file only ever needs its own branches array,
  // so it builds a minimal summary-shaped wrapper rather than widening buildStackRows' own
  // signature for a caller nobody else has.
  return buildStackRows(
    { base: '', baseTip: undefined, branches, needsRestack: false },
    byBranchMap(),
  );
}

function orphanRows(): StackRow[] {
  return buildOrphanRows(props.orphans.visible, byBranchMap());
}

function requestRestack(branch: string): void {
  emit('open-restack-dialog', branch);
}

function requestSetParent(branch: string): void {
  emit('open-set-parent-dialog', branch);
}

/** No confirmation dialog: this is a config-only, fully undoable write (D2/D10) — the same
 *  "reversible, one click" posture `stashDrop`'s own row action already takes. */
async function removeFromStack(branch: string): Promise<void> {
  await props.ops.runStackSet(branch, undefined);
}
</script>

<template>
  <section aria-label="Stacks">
    <RefSectionHeader label="Stacks" />

    <div v-for="group in stacks.visible" :key="group.summary.base" class="kv:mb-1">
      <div class="kv:flex kv:items-center kv:gap-0.5 kv:py-0.5 kv:px-1 kv:font-semibold kv:text-muted-foreground">
        <span class="kv:flex-1 kv:min-w-0 kv:truncate" v-kui-tooltip="`Base: ${group.summary.base}`">{{ group.summary.base }}</span>
        <KuiButton
          v-if="writeCapability"
          class="kv:ml-auto"
          :disabled="!group.summary.needsRestack"
          @click="requestRestack(group.summary.branches[group.summary.branches.length - 1]?.name ?? group.summary.base)"
        >
          Restack
        </KuiButton>
      </div>

      <div
        v-for="row in rowsFor(group.branches)"
        :key="row.name"
        class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
        :style="{ paddingLeft: `calc(var(--kv-s-2) + ${row.depth} * var(--kv-s-4))` }"
        :data-row-id="`stack:${row.name}`"
        :tabindex="focusedRowId === `stack:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main kv:flex kv:items-center kv:gap-0.5 kv:flex-1 kv:min-w-0 kv:text-left">
          <span v-if="row.isHead" class="kv:text-xs kv:opacity-80" v-kui-tooltip="'Current branch'">●</span>
          <span class="kv:truncate">{{ row.name }}</span>
          <span
            v-if="row.stale"
            class="kv-badge kv-badge-pill kv:bg-stack-stale kv:text-stack-stale-fg"
            v-kui-tooltip="row.staleText"
          >
            stale
          </span>
          <button
            v-if="row.pr && openExternalCapability"
            type="button"
            class="kv-badge kv-badge-pill kv-badge-pr"
            :class="`kv-badge-pr--${row.pr.state}`"
            v-kui-tooltip="row.pr.title"
            @click="openPullRequest(row.pr.number)"
          >
            {{ prBadgeLabel(row.pr) }}
          </button>
          <span
            v-else-if="row.pr"
            class="kv-badge kv-badge-pill kv-badge-pr"
            :class="`kv-badge-pr--${row.pr.state}`"
            v-kui-tooltip="row.pr.title"
          >
            {{ prBadgeLabel(row.pr) }}
          </span>
          <span v-if="row.trackText" class="kv:text-xs kv:text-muted-foreground">{{ row.trackText }}</span>
          <span v-if="row.checkedOutIn" class="kv:text-xs kv:opacity-80" v-kui-tooltip="row.checkedOutIn">
            <span class="codicon codicon-repo" aria-hidden="true"></span>
          </span>
        </div>
        <KuiButton
          v-if="writeCapability"
          variant="icon"
          v-kui-tooltip="'Set stack parent…'"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        >
          <span class="codicon codicon-list-tree" aria-hidden="true"></span>
        </KuiButton>
        <KuiButton
          v-if="writeCapability"
          variant="icon"
          v-kui-tooltip="'Remove from stack'"
          aria-label="Remove from stack"
          @click="removeFromStack(row.name)"
        >
          <span class="codicon codicon-close" aria-hidden="true"></span>
        </KuiButton>
      </div>
    </div>

    <div v-if="orphans.visible.length > 0" class="kv:mb-1">
      <div class="kv:flex kv:items-center kv:gap-0.5 kv:py-0.5 kv:px-1 kv:font-semibold kv:text-muted-foreground">
        <span class="kv:flex-1 kv:min-w-0 kv:truncate">Needs attention</span>
      </div>
      <div
        v-for="row in orphanRows()"
        :key="row.name"
        class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
        :data-row-id="`orphan:${row.name}`"
        :tabindex="focusedRowId === `orphan:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main kv:flex kv:items-center kv:gap-0.5 kv:flex-1 kv:min-w-0 kv:text-left">
          <span class="kv:truncate">{{ row.name }}</span>
          <span class="kv:truncate kv:text-xs kv:text-diff-deleted">{{ row.orphanReason }}</span>
        </div>
        <KuiButton
          v-if="writeCapability"
          variant="icon"
          v-kui-tooltip="'Set stack parent…'"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        >
          <span class="codicon codicon-list-tree" aria-hidden="true"></span>
        </KuiButton>
      </div>
    </div>

    <ShowMoreButton :hidden-count="stacks.hiddenCount + orphans.hiddenCount" @click="showMore" />

    <div
      v-if="stacks.visible.length === 0 && orphans.visible.length === 0"
      class="kv:py-0.5 kv:px-2 kv:text-muted-foreground kv:text-xs"
    >
      No stacked branches
    </div>
  </section>
</template>
