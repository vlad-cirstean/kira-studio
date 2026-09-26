<script setup lang="ts">
/**
 * G25 D1/D6/D8: `BranchPicker.vue`'s fourth section — mirrors `StashList.vue`'s own "one row per
 * entry, row-level actions, no filter box" shape (a worktree list is rarely more than a handful of
 * entries). Switch reuses the existing `repo.open` flow (F6: each worktree is already its own
 * `RepoEntry`/`RepoSummary` — "switch" needs no worktree-specific request at all), so this
 * component only EMITS the intent (`switch-worktree`) for `App.vue` to carry out, the same
 * "this component has nowhere of its own to do X" shape `StashList.vue`'s own `branchFromStash`
 * emit already uses. "Open in New Window" is the one action that needs the extension
 * (`worktree.openWindow`, D6) — also emitted up rather than called directly, since this component
 * has no `BridgeClient` of its own (only `ops`/`worktrees`, matching every other row component in
 * this file's own family). Remove is handled entirely locally: a plain `op.run`, no host
 * involvement, with its own small confirm dialog for D8's dirty route.
 *
 * P77 §11: renders the already filtered/ordered/capped `section` prop `pickerModel.ts` hands it —
 * the same `TagList.vue` contract. This is also the first cap this list has ever had (§1.1: it
 * used to render `worktrees.entries.value` straight through, uncapped) — part of N1's fix.
 */
import type { WorktreeEntry, WorktreeRemovePreflight } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { OpsState } from '../state/ops.ts';
import type { WorktreeState } from '../state/worktrees.ts';
import { type PickerList, worktreeLabel } from './pickerModel.ts';
import RefSectionHeader from './RefSectionHeader.vue';
import ShowMoreButton from './ShowMoreButton.vue';

const props = defineProps<{
  section: PickerList<WorktreeEntry>;
  worktrees: WorktreeState;
  ops: OpsState;
  /** Gates the "Open in New Window" row action (D6/D14) — `false` in the harness. */
  openWorktreeWindowCapability: boolean;
  /** C10 §4.2/§4.3: `false` under the native read-only graph — hides create/switch/remove, every
   *  one of which is a write (create/remove are `op.run`; switch is a checkout). The worktree
   *  list itself stays visible (a read); "Open in New Window" is already `false` natively via
   *  `openWorktreeWindowCapability` above, and-ed with this one for the same reason that row is
   *  hidden even where a future host reported both true independently. */
  writeCapability: boolean;
  /** P77 §6.3: raises this tab's own cap — see `TagList.vue`'s own doc comment on this prop. */
  showMore: () => void;
  /** P77 §7.3 — see `TagList.vue`'s own doc comment on this prop. */
  focusedRowId?: string;
}>();

const emit = defineEmits<{
  (e: 'switch-worktree', path: string): void;
  (e: 'open-worktree-window', path: string): void;
  (e: 'create-worktree'): void;
}>();

function switchTo(entry: WorktreeEntry): void {
  if (entry.isCurrent) return;
  emit('switch-worktree', entry.path);
}

function openInNewWindow(entry: WorktreeEntry): void {
  emit('open-worktree-window', entry.path);
}

// ---------------------------------------------------------------------------------------
// Remove (D8) — a small, self-contained confirm dialog: blocked reasons are shown with no route
// forward; a dirty worktree requires typing the exact confirmation token the server's own fresh
// preflight names (never a value this component invents), mirroring G22 D8's own typed-
// confirmation pattern (`ResetDialog.vue`).
// ---------------------------------------------------------------------------------------

const pendingRemove = ref<{ entry: WorktreeEntry; preflight: WorktreeRemovePreflight } | undefined>(
  undefined,
);
const typedToken = ref('');

async function requestRemove(entry: WorktreeEntry): Promise<void> {
  const preflight = await props.worktrees.previewRemove(entry.path);
  if (!preflight) return;
  if (preflight.verdict === 'clean') {
    await props.ops.runWorktreeRemove(entry.path);
    return;
  }
  typedToken.value = '';
  pendingRemove.value = { entry, preflight };
}

function blockerText(preflight: WorktreeRemovePreflight): string {
  const b = preflight.blockers[0];
  if (!b) return '';
  switch (b.kind) {
    case 'notAWorktree':
      return `${b.path} is not one of this repository's worktrees.`;
    case 'mainWorktree':
      return 'The main worktree cannot be removed.';
    case 'currentWorktree':
      return 'This worktree is currently open here and cannot remove itself.';
    case 'openInAnotherWindow':
      return 'This worktree is open in another window — close it there first.';
    case 'locked':
      return `This worktree is locked (${b.reason}) — unlock it first.`;
  }
}

const canConfirmRemove = computed(
  () =>
    pendingRemove.value !== undefined &&
    pendingRemove.value.preflight.verdict === 'dirty' &&
    typedToken.value === pendingRemove.value.preflight.confirmToken,
);

function cancelRemove(): void {
  pendingRemove.value = undefined;
}

async function confirmRemove(): Promise<void> {
  const pending = pendingRemove.value;
  if (!pending || !canConfirmRemove.value) return;
  pendingRemove.value = undefined;
  await props.ops.runWorktreeRemove(pending.entry.path, pending.preflight.confirmToken);
}
</script>

<template>
  <section aria-label="Worktrees">
    <RefSectionHeader label="Worktrees">
      <KuiButton
        v-if="writeCapability"
        class="kv:ml-auto"
        @click="emit('create-worktree')"
      >
        Create Worktree…
      </KuiButton>
    </RefSectionHeader>
    <div
      v-for="entry in section.visible"
      :key="entry.path"
      class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
      :data-row-id="`worktree:${entry.path}`"
      :tabindex="focusedRowId === `worktree:${entry.path}` ? 0 : -1"
    >
      <div class="kv-branch-row-main kv:flex kv:items-center kv:gap-0.5 kv:flex-1 kv:min-w-0 kv:text-left">
        <span v-if="entry.isCurrent" class="kv:text-sm kv:opacity-80" v-kui-tooltip="'This window'">●</span>
        <span v-if="entry.isMain" class="kv:text-sm kv:opacity-80" v-kui-tooltip="'Main worktree'">M</span>
        <span v-if="entry.locked" class="kv:text-sm kv:opacity-80" v-kui-tooltip="entry.locked.reason">
          <span class="codicon codicon-lock" aria-hidden="true"></span>
        </span>
        <span v-if="entry.openElsewhere" class="kv:text-sm kv:opacity-80" v-kui-tooltip="'Open in another window'">
          <span class="codicon codicon-window" aria-hidden="true"></span>
        </span>
        <span class="kv:truncate" v-kui-tooltip="entry.path">{{ worktreeLabel(entry) }}</span>
        <span class="kv:flex-1 kv:min-w-0 kv:truncate kv:text-sm kv:text-muted-foreground">{{ entry.path }}</span>
      </div>
      <KuiButton
        v-if="writeCapability && !entry.isCurrent"
        variant="icon"
        v-kui-tooltip="'Switch to this worktree'"
        aria-label="Switch to this worktree"
        @click="switchTo(entry)"
      >
        <span class="codicon codicon-arrow-swap" aria-hidden="true"></span>
      </KuiButton>
      <KuiButton
        v-if="writeCapability && openWorktreeWindowCapability"
        variant="icon"
        v-kui-tooltip="'Open in new window'"
        aria-label="Open in new window"
        @click="openInNewWindow(entry)"
      >
        <span class="codicon codicon-empty-window" aria-hidden="true"></span>
      </KuiButton>
      <KuiButton
        v-if="writeCapability && !entry.isMain && !entry.isCurrent"
        variant="icon"
        v-kui-tooltip="'Remove worktree'"
        aria-label="Remove worktree"
        @click="requestRemove(entry)"
      >
        <span class="codicon codicon-trash" aria-hidden="true"></span>
      </KuiButton>
    </div>
    <ShowMoreButton :hidden-count="section.hiddenCount" @click="showMore" />
    <div v-if="section.visible.length === 0" class="kv:py-0.5 kv:px-2 kv:text-muted-foreground kv:text-sm">No worktrees</div>

    <KuiDialog
      :open="pendingRemove !== undefined"
      :title="pendingRemove ? `Remove ${pendingRemove.entry.path}` : ''"
      @close="cancelRemove"
    >
      <template v-if="pendingRemove?.preflight.verdict === 'blocked'">
        <p class="kv:text-diff-deleted">{{ blockerText(pendingRemove.preflight) }}</p>
      </template>
      <template v-else-if="pendingRemove?.preflight.verdict === 'dirty'">
        <p>
          This worktree has uncommitted changes that will be permanently lost. Type
          <code>{{ pendingRemove.preflight.confirmToken }}</code> to confirm.
        </p>
        <input type="text" v-model="typedToken" />
      </template>
      <template #actions>
        <KuiButton
          v-if="pendingRemove?.preflight.verdict === 'dirty'"
          variant="primary"
          :disabled="!canConfirmRemove"
          @click="confirmRemove"
        >
          Remove anyway
        </KuiButton>
        <KuiButton @click="cancelRemove">Cancel</KuiButton>
      </template>
    </KuiDialog>
  </section>
</template>

