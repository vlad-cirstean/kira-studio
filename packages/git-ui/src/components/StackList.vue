<script setup lang="ts">
/**
 * G26 D3/F13/F14: `BranchPicker.vue`'s fifth section — one sub-list per `StackSummary`, rows
 * pre-order bottom-to-top with `depth`-driven indent (D3), a PR badge and track text reused
 * verbatim from `PrState.byBranch`/`RefRow` (F13/F14), a stale chip, and a header "Restack" button
 * per stack. Row-level "Set stack parent…"/"Remove from stack" mirror `WorktreeList.vue`'s own
 * "this component has nowhere of its own to do X" shape: both EMIT the intent for `App.vue` to
 * open `StackDialog.vue` with, rather than this file owning a second dialog. The Restack button
 * does the same — `StackDialog.vue` is the one place the plan/blockers/progress actually render.
 */
import type { StackBranch } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { StackState } from '../state/stack.ts';
import { buildOrphanRows, buildStackRows, prBadgeLabel, type StackRow } from './stackListModel.ts';

const props = defineProps<{
  stack: StackState;
  ops: OpsState;
  /** G24 D9's own branch-tip badge — optional so a caller with nothing to show yet gets a
   *  plain, badge-free list (mirrors `BranchPicker.vue`'s own `pr` prop). */
  pr?: PrState;
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
  return buildOrphanRows(props.stack.orphans.value, byBranchMap());
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
  <div class="kv-branch-section" aria-label="Stacks">
    <div class="kv-branch-section-title">Stacks</div>

    <div v-for="summary in stack.stacks.value" :key="summary.base" class="kv-stack-group">
      <div class="kv-stack-header">
        <span class="kv-stack-base" v-kui-tooltip="`Base: ${summary.base}`">{{ summary.base }}</span>
        <KuiButton
          class="kv-stack-restack"
          :disabled="!summary.needsRestack"
          @click="requestRestack(summary.branches[summary.branches.length - 1]?.name ?? summary.base)"
        >
          Restack
        </KuiButton>
      </div>

      <div
        v-for="row in rowsFor(summary.branches)"
        :key="row.name"
        class="kv-branch-row kv-stack-row"
        :style="{ paddingLeft: `calc(var(--kv-s-2) + ${row.depth} * var(--kv-s-4))` }"
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
          <a
            v-if="row.pr"
            class="kv-badge kv-badge-pill kv-badge-pr"
            :class="`kv-badge-pr--${row.pr.state}`"
            :href="row.pr.url"
            v-kui-tooltip="row.pr.title"
          >
            {{ prBadgeLabel(row.pr) }}
          </a>
          <span v-if="row.trackText" class="kv-stack-track">{{ row.trackText }}</span>
          <span v-if="row.checkedOutIn" class="kv-stack-badge" v-kui-tooltip="row.checkedOutIn">
            <span class="codicon codicon-repo" aria-hidden="true"></span>
          </span>
        </div>
        <KuiButton
          class="kv-icon-button"
          v-kui-tooltip="'Set stack parent…'"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        >
          <span class="codicon codicon-list-tree" aria-hidden="true"></span>
        </KuiButton>
        <KuiButton
          class="kv-icon-button"
          v-kui-tooltip="'Remove from stack'"
          aria-label="Remove from stack"
          @click="removeFromStack(row.name)"
        >
          <span class="codicon codicon-close" aria-hidden="true"></span>
        </KuiButton>
      </div>
    </div>

    <div v-if="stack.orphans.value.length > 0" class="kv-stack-group">
      <div class="kv-stack-header">
        <span class="kv-stack-base">Needs attention</span>
      </div>
      <div v-for="row in orphanRows()" :key="row.name" class="kv-branch-row kv-stack-row">
        <div class="kv-branch-row-main kv-stack-row-main">
          <span class="kv-stack-label">{{ row.name }}</span>
          <span class="kv-stack-orphan-reason">{{ row.orphanReason }}</span>
        </div>
        <KuiButton
          class="kv-icon-button"
          v-kui-tooltip="'Set stack parent…'"
          aria-label="Set stack parent"
          @click="requestSetParent(row.name)"
        >
          <span class="codicon codicon-list-tree" aria-hidden="true"></span>
        </KuiButton>
      </div>
    </div>

    <div
      v-if="stack.stacks.value.length === 0 && stack.orphans.value.length === 0"
      class="kv-branch-empty"
    >
      No stacked branches
    </div>
  </div>
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
