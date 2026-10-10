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
import CodiconIcon from '@theme/CodiconIcon.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { computed, ref } from 'vue';
import type { OpsState } from '../state/ops.ts';
import type { WorktreeState } from '../state/worktrees.ts';
import { type PickerList, worktreeLabel } from './pickerModel.ts';
import ShowMoreButton from './ShowMoreButton.vue';

const props = defineProps<{
  section: PickerList<WorktreeEntry>;
  worktrees: WorktreeState;
  ops: OpsState;
  /** P77 §6.3: raises this tab's own cap — see `TagList.vue`'s own doc comment on this prop. */
  showMore: () => void;
  /** P77 §7.3 — see `TagList.vue`'s own doc comment on this prop. */
  focusedRowId?: string;
}>();

const emit = defineEmits<{
  (e: 'switch-worktree', path: string): void;
  (e: 'create-worktree'): void;
}>();

function switchTo(entry: WorktreeEntry): void {
  if (entry.isCurrent) return;
  emit('switch-worktree', entry.path);
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
    <SectionHeading label="Worktrees">
      <Button variant="toolbar" size="kira" class="ml-auto" @click="emit('create-worktree')">
        Create Worktree…
      </Button>
    </SectionHeading>
    <div data-testid="branch-row"
      v-for="entry in section.visible"
      :key="entry.path"
      class="flex items-center gap-0.5 px-1"
      :data-row-id="`worktree:${entry.path}`"
      :tabindex="focusedRowId === `worktree:${entry.path}` ? 0 : -1"
    >
      <div data-testid="branch-row-main" class="flex items-center gap-0.5 flex-1 min-w-0 text-left">
        <span v-if="entry.isCurrent" class="text-kira-sm text-subtle" data-kira-tip="This window">●</span>
        <span v-if="entry.isMain" class="text-kira-sm text-subtle" data-kira-tip="Main worktree">M</span>
        <span v-if="entry.locked" class="text-kira-sm text-subtle" :data-kira-tip="entry.locked.reason">
          <CodiconIcon name="lock" :size="13" />
        </span>
        <span v-if="entry.openElsewhere" class="text-kira-sm text-subtle" data-kira-tip="Open in another window">
          <CodiconIcon name="window" :size="13" />
        </span>
        <span class="truncate" :data-kira-tip="entry.path">{{ worktreeLabel(entry) }}</span>
        <span class="flex-1 min-w-0 truncate text-kira-sm text-muted-foreground">{{ entry.path }}</span>
      </div>
      <TooltipIconButton
        v-if="!entry.isCurrent"
        icon="arrow-swap"
        label="Switch to this worktree"
        @click="switchTo(entry)"
      />
      <TooltipIconButton
        v-if="!entry.isMain && !entry.isCurrent"
        icon="trash"
        label="Remove worktree"
        @click="requestRemove(entry)"
      />
    </div>
    <ShowMoreButton :hidden-count="section.hiddenCount" @click="showMore" />
    <div v-if="section.visible.length === 0" class="text-kira-sm text-subtle py-1 px-1.5">No worktrees</div>

    <!-- P131 Part 2 §5: opens inside BranchPicker's own modal Popover panel (§5.2) -- reka's
         modal content there prevents the panel dismissing under this nested Dialog. -->
    <Dialog :open="pendingRemove !== undefined" @update:open="(v) => !v && cancelRemove()">
      <DialogContent
        :aria-describedby="undefined"
        size="md"
      >
        <DialogHeader closable>
          <DialogTitle>{{ pendingRemove ? `Remove ${pendingRemove.entry.path}` : '' }}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <template v-if="pendingRemove?.preflight.verdict === 'blocked'">
            <FieldError>{{ blockerText(pendingRemove.preflight) }}</FieldError>
          </template>
          <template v-else-if="pendingRemove?.preflight.verdict === 'dirty'">
            <p>
              This worktree has uncommitted changes that will be permanently lost. Type
              <code class="font-data">{{ pendingRemove.preflight.confirmToken }}</code> to confirm.
            </p>
            <Input v-model="typedToken" size="kira-lg" class="w-full" aria-label="Confirmation token" />
          </template>
        </DialogBody>
        <DialogFooter>
          <Button variant="dialog" size="kira-lg" @click="cancelRemove">Cancel</Button>
          <Button
            v-if="pendingRemove?.preflight.verdict === 'dirty'"
            variant="dialog-primary"
            size="kira-lg"
            :disabled="!canConfirmRemove"
            @click="confirmRemove"
          >
            Remove anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

