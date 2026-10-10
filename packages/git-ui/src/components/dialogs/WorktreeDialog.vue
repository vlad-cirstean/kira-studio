<script setup lang="ts">
/**
 * G25 D2-D4/D9-D14: "Create Worktree…" (`AppToolbar.vue`'s own button, and the palette's
 * `createWorktree` action).
 *
 * The three explicit modes (D3): `existingBranch` (pick a branch already in `refs`), `newBranch`
 * (name + start point), `detach` (a bare commit-ish). `preflight.worktreeAdd`'s own live
 * pre-flight (D4) re-runs on every keystroke, exactly like `RevertDialog.vue`'s mainline picker
 * re-runs `previewRevertMainline` — this dialog never lets `runWorktreeAdd` spawn against a
 * blocked combination the user can already see is blocked.
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now, `title` feeds
 * `DialogTitle`'s default slot, and the create phase's mode picker/text fields are
 * RadioGroup/Input.
 */
import { validateRefName } from '@kira/git-core';
import type { WorktreeAddPreflight } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import type { RefsState } from '../../state/refs.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../../state/worktrees.ts';

const props = defineProps<{
  worktrees: WorktreeState;
  ops: OpsState;
  refs: RefsState;
  /** Set by `AppToolbar.vue`'s "Create Worktree…" button, the `createWorktree` palette action, or
   *  a "Create worktree here…" row action (P76 §8/§9), via `App.vue`. A fresh object (even `{}`)
   *  opens the dialog and re-seeds it; `undefined` closes it. Watched by reference rather
   *  than a boolean so a second row action re-seeds even while the dialog is already open. */
  createRequest: WorktreeCreateSeed | undefined;
  /** `kiraSpace.worktree.basePath`'s current value — pre-fills the path field's own directory
   *  (D10); pure UX, never validated as an existing directory. */
  basePathDefault: string;
}>();

const emit = defineEmits<(e: 'close-create') => void>();

const active = computed(() => props.createRequest !== undefined);

// ---------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------

type Mode = 'existingBranch' | 'newBranch' | 'detach';

const path = ref('');
const mode = ref<Mode>('newBranch');
const branch = ref('');
const startPoint = ref('');
const preflight = ref<WorktreeAddPreflight | undefined>(undefined);
const pathId = useId();
const branchId = useId();
const startPointId = useId();
let previewToken = 0;

watch(
  () => props.createRequest,
  (seed) => {
    if (!seed) return;
    path.value = '';
    mode.value = seed.mode ?? 'newBranch';
    branch.value = seed.branch ?? '';
    startPoint.value =
      seed.startPoint ??
      (props.refs.head.value?.kind === 'branch' ? props.refs.head.value.name : '');
    preflight.value = undefined;
  },
);

/** D3's own "visible suggestion instead of relying on git's bare DWIM" — the basename of a
 *  branch/start-point name the user just typed, offered as a starting point for an EMPTY path
 *  field only, never overwriting one the user has already edited. */
watch([branch, startPoint], ([b, s]) => {
  if (path.value.trim() !== '') return;
  const suggestion = mode.value === 'existingBranch' ? b : mode.value === 'newBranch' ? b : s;
  if (suggestion.trim() === '') return;
  const base = props.basePathDefault.trim();
  path.value =
    base === '' ? suggestion.trim() : `${base.replace(/[/\\]+$/, '')}/${suggestion.trim()}`;
});

const newBranchNameError = computed(() => {
  if (mode.value !== 'newBranch' || branch.value.trim() === '') return undefined;
  const { valid, error } = validateRefName(branch.value.trim());
  return valid ? undefined : error;
});

watch([path, mode, branch, startPoint], async ([p, m, b, s]) => {
  if (p.trim() === '') {
    preflight.value = undefined;
    return;
  }
  const token = ++previewToken;
  const result = await props.worktrees.previewAdd({
    path: p.trim(),
    mode: m,
    branch: m === 'detach' ? undefined : b.trim() || undefined,
    startPoint: m === 'existingBranch' ? undefined : s.trim() || undefined,
  });
  if (token === previewToken) preflight.value = result;
});

const canSubmitCreate = computed(() => {
  if (path.value.trim() === '') return false;
  if (mode.value === 'newBranch' && (branch.value.trim() === '' || newBranchNameError.value)) {
    return false;
  }
  if (mode.value === 'existingBranch' && branch.value.trim() === '') return false;
  if (mode.value === 'detach' && startPoint.value.trim() === '') return false;
  return preflight.value !== undefined && preflight.value.verdict !== 'blocked';
});

function cancelCreate(): void {
  emit('close-create');
}

async function submitCreate(): Promise<void> {
  if (!canSubmitCreate.value) return;
  const trimmedPath = path.value.trim();
  const result = await props.ops.runWorktreeAdd({
    path: trimmedPath,
    mode: mode.value,
    branch: mode.value === 'detach' ? undefined : branch.value.trim() || undefined,
    startPoint: mode.value === 'existingBranch' ? undefined : startPoint.value.trim() || undefined,
  });
  if (!result.ok) return; // the failure is already announced (opsState.announcement) — stay open.
  emit('close-create');
}

/** G28 D7: closes G25 §9's own named hand-forward — OFFERED, never taken automatically (unlike
 *  checkout's own D6 route): this dialog is already open, so there is a natural place to ask,
 *  and `worktree add` carries no "never blocks" promise to keep. Re-issues the SAME `worktreeAdd`
 *  op with `mode: 'detach'` and `startPoint: <that branch>` — no new op kind, no new argv. */
function detachHereBranch(): string | undefined {
  const blocker = preflight.value?.blockers.find((b) => b.kind === 'branchCheckedOutElsewhere');
  return blocker?.kind === 'branchCheckedOutElsewhere' ? blocker.branch : undefined;
}

const canOfferDetachHere = computed(
  () => (preflight.value?.routes.includes('detachHere') ?? false) && path.value.trim() !== '',
);

async function submitCreateDetached(): Promise<void> {
  const branchName = detachHereBranch();
  if (!canOfferDetachHere.value || branchName === undefined) return;
  const trimmedPath = path.value.trim();
  const result = await props.ops.runWorktreeAdd({
    path: trimmedPath,
    mode: 'detach',
    branch: undefined,
    startPoint: branchName,
  });
  if (!result.ok) return;
  emit('close-create');
}

const title = 'Create worktree';

function onClose(): void {
  cancelCreate();
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && onClose()">
    <DialogContent
      :show-close-button="false"
      :aria-describedby="undefined"
      class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-2 overflow-auto px-3 py-2">
        <template v-if="active">
          <label :for="pathId" class="flex flex-col gap-0.5">
            Path
            <Input
              :id="pathId"
              v-model="path"
              type="text"
              size="kira"
              class="w-full"
              placeholder="../my-repo-feature-x"
            />
          </label>
          <fieldset class="flex flex-col gap-0.5">
            <legend>Start from</legend>
            <RadioGroup v-model="mode">
              <Label class="flex flex-row items-center gap-1">
                <RadioGroupItem value="existingBranch" />
                An existing branch
              </Label>
              <Label class="flex flex-row items-center gap-1">
                <RadioGroupItem value="newBranch" />
                A new branch
              </Label>
              <Label class="flex flex-row items-center gap-1">
                <RadioGroupItem value="detach" />
                Detached (no branch)
              </Label>
            </RadioGroup>
          </fieldset>

          <label v-if="mode === 'existingBranch'" :for="branchId" class="flex flex-col gap-0.5">
            Branch
            <Input
              :id="branchId"
              v-model="branch"
              type="text"
              size="kira"
              class="w-full"
              list="kv-worktree-branches"
              placeholder="branch name"
            />
            <datalist id="kv-worktree-branches">
              <option v-for="row in refs.branches.value" :key="row.refname" :value="row.shortName" />
            </datalist>
          </label>
          <template v-else-if="mode === 'newBranch'">
            <label :for="branchId" class="flex flex-col gap-0.5">
              New branch name
              <Input :id="branchId" v-model="branch" type="text" size="kira" class="w-full" placeholder="feature/x" />
            </label>
            <p v-if="newBranchNameError" class="text-error">{{ newBranchNameError }}</p>
            <label :for="startPointId" class="flex flex-col gap-0.5">
              Start point
              <Input :id="startPointId" v-model="startPoint" type="text" size="kira" class="w-full" placeholder="main" />
            </label>
          </template>
          <label v-else :for="startPointId" class="flex flex-col gap-0.5">
            Commit-ish
            <Input
              :id="startPointId"
              v-model="startPoint"
              type="text"
              size="kira"
              class="w-full"
              placeholder="a branch, tag or sha"
            />
          </label>

          <template v-if="preflight">
            <p v-for="blocker in preflight.blockers" :key="blocker.kind" class="text-error">
              <template v-if="blocker.kind === 'invalidPath'">The path is invalid.</template>
              <template v-else-if="blocker.kind === 'pathExists'">
                <code>{{ blocker.path }}</code> already exists.
              </template>
              <template v-else-if="blocker.kind === 'branchCheckedOutElsewhere'">
                <code>{{ blocker.branch }}</code> is already checked out at
                <code>{{ blocker.worktreePath }}</code>.
              </template>
              <template v-else-if="blocker.kind === 'branchExists'">
                A branch named <code>{{ blocker.branch }}</code> already exists.
              </template>
              <template v-else-if="blocker.kind === 'unknownStartPoint'">
                <code>{{ blocker.startPoint }}</code> does not resolve to a commit.
              </template>
            </p>
            <p v-if="canOfferDetachHere" class="text-error">
              The new worktree will start with a detached HEAD.
            </p>
            <Button v-if="canOfferDetachHere" variant="dialog-primary" size="kira-lg" @click="submitCreateDetached">
              Create it detached at that branch's commit
            </Button>
            <p v-for="note in preflight.notes" :key="note.kind" class="text-error">
              <template v-if="note.kind === 'pathInsideRepo'">
                This path is inside the current repository.
              </template>
              <template v-else-if="note.kind === 'parentDirectoryMissing'">
                The parent directory will be created.
              </template>
              <template v-else-if="note.kind === 'detachedHead'">
                The new worktree will start with a detached HEAD.
              </template>
            </p>
          </template>
        </template>

      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" @click="cancelCreate">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmitCreate" @click="submitCreate">
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
