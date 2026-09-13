<script setup lang="ts">
/**
 * G26 D14/4.8: two modes, at most one active at a time (`props.target?.mode`), mirroring
 * `WorktreeDialog.vue`'s own "App.vue owns the state, this component owns nothing of its own"
 * shape:
 * - **setParent** — `op.run`'s `stackSet` kind directly: pick an existing local branch as the new
 *   parent (or "None" to remove `target.branch` from its stack, D2/D10). No preflight endpoint of
 *   its own (D10's cycle check runs host-side, at write time) — this dialog is the confirm step,
 *   the same posture `BranchDialog.vue`'s rename mode already takes.
 * - **restack** — `preflight.restack`'s own live plan/blockers (re-fetched on open), a live
 *   progress list driven by `StackState.progress` while `StackState.restacking` is true, and a
 *   Cancel button that calls `ops.cancelRestack()`. A paused (conflicted) restack is surfaced
 *   here in words (D8) — resolving it is G5's own `ConflictBanner.vue`, not a second UI here.
 */
import type { RestackPreflight } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import type { RefsState } from '../../state/refs.ts';
import type { StackState } from '../../state/stack.ts';

const props = defineProps<{
  stack: StackState;
  ops: OpsState;
  refs: RefsState;
  /** `App.vue` owns this — `undefined` means closed. Toggled by `StackList.vue`'s own row/header
   *  actions, the row menu's stack section, and the `restackStack` palette action. */
  target: { readonly mode: 'setParent' | 'restack'; readonly branch: string } | undefined;
}>();

const emit = defineEmits<(e: 'close') => void>();

const open = computed(() => props.target !== undefined);

// ---------------------------------------------------------------------------------------
// setParent
// ---------------------------------------------------------------------------------------

const selectedParent = ref('');

watch(
  () => props.target,
  (target) => {
    if (target === undefined || target.mode !== 'setParent') return;
    selectedParent.value = '';
  },
);

const parentCandidates = computed(() =>
  props.refs.branches.value
    .map((row) => row.shortName)
    .filter((name) => name !== props.target?.branch),
);

async function submitSetParent(): Promise<void> {
  const target = props.target;
  if (target === undefined) return;
  await props.ops.runStackSet(target.branch, selectedParent.value || undefined);
  emit('close');
}

// ---------------------------------------------------------------------------------------
// restack
// ---------------------------------------------------------------------------------------

const preflight = ref<RestackPreflight | undefined>(undefined);
let previewToken = 0;

async function loadPreflight(branch: string): Promise<void> {
  const token = ++previewToken;
  const result = await props.stack.previewRestack(branch);
  if (token === previewToken) preflight.value = result;
}

watch(
  () => props.target,
  (target) => {
    if (target === undefined || target.mode !== 'restack') {
      preflight.value = undefined;
      return;
    }
    void loadPreflight(target.branch);
  },
  { immediate: true },
);

function blockerText(pf: RestackPreflight): string {
  const b = pf.blockers[0];
  if (!b) return '';
  switch (b.kind) {
    case 'inProgressOperation':
      return 'Another operation is already in progress.';
    case 'notStacked':
      return `${b.branch} is not part of a stack.`;
    case 'cycle':
      return `This stack has a cycle: ${b.branches.join(' → ')}.`;
    case 'parentMissing':
      return `${b.branch}'s recorded parent "${b.parent}" no longer exists.`;
    case 'checkedOutElsewhere':
      return `${b.branch} is checked out at ${b.worktreePath}.`;
    case 'dirtyWorktree':
      return 'Commit, stash, or discard your changes before restacking.';
  }
}

async function submitRestack(): Promise<void> {
  const target = props.target;
  if (target === undefined || props.stack.restacking.value) return;
  await props.ops.runRestack(target.branch);
  // A conflict/cancellation leaves real state to look at (G5's own ConflictBanner) — re-fetch the
  // preflight rather than closing, so the dialog's own plan reflects what is actually left.
  if (props.target !== undefined) await loadPreflight(target.branch);
}

function cancelRestack(): void {
  void props.ops.cancelRestack();
}

function closeDialog(): void {
  emit('close');
}
</script>

<template>
  <KuiDialog
    :open="open"
    :title="target?.mode === 'setParent' ? `Set ${target.branch}'s stack parent` : `Restack ${target?.branch ?? ''}`"
    @close="closeDialog"
  >
    <template v-if="target?.mode === 'setParent'">
      <label class="kv-dialog-field">
        Parent branch
        <select v-model="selectedParent">
          <option value="">None (remove from stack)</option>
          <option v-for="name in parentCandidates" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
    </template>

    <template v-else-if="target?.mode === 'restack' && preflight">
      <p v-if="preflight.verdict === 'blocked'" class="kv-dialog-error">
        {{ blockerText(preflight) }}
      </p>
      <p v-else-if="preflight.verdict === 'noop'">This stack is already up to date.</p>
      <template v-else>
        <p>The following branches will be restacked onto <code>{{ preflight.base }}</code>:</p>
        <ul class="kv-stack-plan">
          <li v-for="entry in preflight.plan" :key="entry.branch">
            <code>{{ entry.branch }}</code> onto <code>{{ entry.parent }}</code>
            ({{ entry.commits }} commit{{ entry.commits === 1 ? '' : 's' }},
            {{ entry.reason === 'stale' ? 'stale' : 'ancestor restacked' }},
            base: {{ entry.baseSource }})
          </li>
        </ul>
        <p v-if="preflight.needsForcePush.length > 0" class="kv-dialog-note">
          These branches will need a force-push afterwards:
          {{ preflight.needsForcePush.join(', ') }}.
        </p>
      </template>

      <template v-if="stack.restacking.value">
        <p>Restacking…</p>
        <ul class="kv-stack-progress">
          <li v-for="(p, i) in stack.progress.value" :key="i">
            {{ p.branch }} ({{ p.index }}/{{ p.total }})
          </li>
        </ul>
      </template>
    </template>

    <template #actions>
      <template v-if="target?.mode === 'setParent'">
        <KuiButton variant="primary" @click="submitSetParent">Save</KuiButton>
        <KuiButton @click="closeDialog">Cancel</KuiButton>
      </template>
      <template v-else-if="target?.mode === 'restack'">
        <template v-if="stack.restacking.value">
          <KuiButton @click="cancelRestack">Cancel restack</KuiButton>
        </template>
        <template v-else>
          <KuiButton
            variant="primary"
            :disabled="!preflight || preflight.verdict === 'blocked' || preflight.verdict === 'noop'"
            @click="submitRestack"
          >
            Restack
          </KuiButton>
          <KuiButton @click="closeDialog">Close</KuiButton>
        </template>
      </template>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  margin: var(--kv-s-2) 0;
}

.kv-dialog-field select {
  padding: var(--kv-s-1) var(--kv-s-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-dialog-error {
  color: var(--kv-diff-deleted-fg);
}

.kv-dialog-note {
  color: var(--kv-description-fg);
}

.kv-stack-plan,
.kv-stack-progress {
  max-height: 200px;
  overflow-y: auto;
  padding: var(--kv-s-2);
  background: var(--kv-panel-bg);
  border: 1px solid var(--kv-panel-border);
  font-size: 0.9em;
}
</style>
