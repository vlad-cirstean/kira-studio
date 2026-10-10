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
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import { prBadgeClass, refBadgeClass } from './badgeClass.ts';
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
  /** P74 §3.3 — see `BranchPicker.vue`'s own doc comment, threaded straight through from
   *  `AppToolbar.vue`. */
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

    <div v-for="group in stacks.visible" :key="group.summary.base" class="mb-1">
      <div class="flex items-center gap-0.5 py-0.5 px-1 font-semibold text-muted-foreground">
        <span class="flex-1 min-w-0 truncate" :data-kira-tip="`Base: ${group.summary.base}`">{{ group.summary.base }}</span>
        <Button
          variant="toolbar"
          size="kira"
          class="ml-auto"
          :disabled="!group.summary.needsRestack"
          @click="requestRestack(group.summary.branches[group.summary.branches.length - 1]?.name ?? group.summary.base)"
        >
          Restack
        </Button>
      </div>

      <div
        v-for="row in rowsFor(group.branches)"
        :key="row.name"
        class="kv-branch-row flex items-center gap-0.5 px-1"
        :style="{ paddingLeft: `calc(var(--kv-s-2) + ${row.depth} * var(--kv-s-4))` }"
        :data-row-id="`stack:${row.name}`"
        :tabindex="focusedRowId === `stack:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main flex items-center gap-0.5 flex-1 min-w-0 text-left">
          <span v-if="row.isHead" class="text-kira-sm opacity-80" data-kira-tip="Current branch">●</span>
          <span class="truncate">{{ row.name }}</span>
          <span
            v-if="row.stale"
            :class="refBadgeClass('bg-(--kv-stack-stale-bg) text-(color:--kv-stack-stale-fg)')"
            :data-kira-tip="row.staleText"
          >
            stale
          </span>
          <button
            v-if="row.pr"
            type="button"
            :class="prBadgeClass(row.pr.state)"
            :data-kira-tip="row.pr.title"
            @click="openPullRequest(row.pr.number)"
          >
            {{ prBadgeLabel(row.pr) }}
          </button>
          <span v-if="row.trackText" class="text-kira-sm text-muted-foreground">{{ row.trackText }}</span>
          <span v-if="row.checkedOutIn" class="text-kira-sm opacity-80" :data-kira-tip="row.checkedOutIn">
            <CodiconIcon name="repo" :size="13" />
          </span>
        </div>
        <TooltipIconButton
          icon="list-tree"
          label="Set stack parent…"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        />
        <TooltipIconButton
          icon="close"
          label="Remove from stack"
          @click="removeFromStack(row.name)"
        />
      </div>
    </div>

    <div v-if="orphans.visible.length > 0" class="mb-1">
      <div class="flex items-center gap-0.5 py-0.5 px-1 font-semibold text-muted-foreground">
        <span class="flex-1 min-w-0 truncate">Needs attention</span>
      </div>
      <div
        v-for="row in orphanRows()"
        :key="row.name"
        class="kv-branch-row flex items-center gap-0.5 px-1"
        :data-row-id="`orphan:${row.name}`"
        :tabindex="focusedRowId === `orphan:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main flex items-center gap-0.5 flex-1 min-w-0 text-left">
          <span class="truncate">{{ row.name }}</span>
          <span class="truncate text-kira-sm text-error">{{ row.orphanReason }}</span>
        </div>
        <TooltipIconButton
          icon="list-tree"
          label="Set stack parent…"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        />
      </div>
    </div>

    <ShowMoreButton :hidden-count="stacks.hiddenCount + orphans.hiddenCount" @click="showMore" />

    <div
      v-if="stacks.visible.length === 0 && orphans.visible.length === 0"
      class="py-0.5 px-2 text-muted-foreground text-kira-sm"
    >
      No stacked branches
    </div>
  </section>
</template>
