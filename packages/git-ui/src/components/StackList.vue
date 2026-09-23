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
import { REF_LIST_SECTION_CAP } from './refListModel.ts';
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
  <section class="kv-branch-section" aria-label="Stacks">
    <div class="kv-branch-section-title">Stacks</div>

    <div v-for="group in stacks.visible" :key="group.summary.base" class="kv-stack-group">
      <div class="kv-stack-header">
        <span class="kv-stack-base" v-kui-tooltip="`Base: ${group.summary.base}`">{{ group.summary.base }}</span>
        <KuiButton
          v-if="writeCapability"
          class="kv-stack-restack"
          :disabled="!group.summary.needsRestack"
          @click="requestRestack(group.summary.branches[group.summary.branches.length - 1]?.name ?? group.summary.base)"
        >
          Restack
        </KuiButton>
      </div>

      <div
        v-for="row in rowsFor(group.branches)"
        :key="row.name"
        class="kv-branch-row kv-stack-row"
        :style="{ paddingLeft: `calc(var(--kv-s-2) + ${row.depth} * var(--kv-s-4))` }"
        :data-row-id="`stack:${row.name}`"
        :tabindex="focusedRowId === `stack:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main kv-stack-row-main">
          <span v-if="row.isHead" class="kv-stack-badge" v-kui-tooltip="'Current branch'">●</span>
          <span class="kv-stack-label">{{ row.name }}</span>
          <span
            v-if="row.stale"
            class="kv-badge kv-badge-pill kv-stack-stale"
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
          <span v-if="row.trackText" class="kv-stack-track">{{ row.trackText }}</span>
          <span v-if="row.checkedOutIn" class="kv-stack-badge" v-kui-tooltip="row.checkedOutIn">
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

    <div v-if="orphans.visible.length > 0" class="kv-stack-group">
      <div class="kv-stack-header">
        <span class="kv-stack-base">Needs attention</span>
      </div>
      <div
        v-for="row in orphanRows()"
        :key="row.name"
        class="kv-branch-row kv-stack-row"
        :data-row-id="`orphan:${row.name}`"
        :tabindex="focusedRowId === `orphan:${row.name}` ? 0 : -1"
      >
        <div class="kv-branch-row-main kv-stack-row-main">
          <span class="kv-stack-label">{{ row.name }}</span>
          <span class="kv-stack-orphan-reason">{{ row.orphanReason }}</span>
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

    <KuiButton
      v-if="stacks.hiddenCount > 0 || orphans.hiddenCount > 0"
      class="kv-branch-more-button"
      @click="showMore"
    >
      Show {{ Math.min(REF_LIST_SECTION_CAP, stacks.hiddenCount + orphans.hiddenCount) }} more
      ({{ stacks.hiddenCount + orphans.hiddenCount }} remaining)
    </KuiButton>

    <div
      v-if="stacks.visible.length === 0 && orphans.visible.length === 0"
      class="kv-branch-empty"
    >
      No stacked branches
    </div>
  </section>
</template>

<style scoped>
.kv-stack-group {
  margin-bottom: var(--kv-s-2);
}

.kv-stack-header {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  padding: var(--kv-s-1) var(--kv-s-2);
  font-weight: 600;
  color: var(--kv-description-fg);
}

.kv-stack-base {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-stack-restack {
  margin-left: auto;
}

.kv-stack-row-main {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  flex: 1;
  min-width: 0;
}

.kv-stack-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kv-stack-badge {
  font-size: 0.85em;
  opacity: 0.8;
}

.kv-stack-track {
  font-size: 0.85em;
  color: var(--kv-description-fg);
}

.kv-stack-stale {
  background: var(--kv-stack-stale-bg, var(--kv-diff-deleted-fg));
  color: var(--kv-stack-stale-fg, var(--kv-panel-bg));
}

.kv-stack-orphan-reason {
  font-size: 0.85em;
  color: var(--kv-diff-deleted-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
