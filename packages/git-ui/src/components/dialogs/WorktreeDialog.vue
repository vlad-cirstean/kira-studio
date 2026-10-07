<script setup lang="ts">
/**
 * G25 D2-D4/D9-D14: "Create Worktree…" (`AppToolbar.vue`'s own button, and the palette's
 * `createWorktree` action) plus the prepare-script run that can immediately follow it.
 *
 * Two phases, at most one active at a time (`phase` below):
 * - **create** — the three explicit modes (D3): `existingBranch` (pick a branch already in
 *   `refs`), `newBranch` (name + start point), `detach` (a bare commit-ish). `preflight.
 *   worktreeAdd`'s own live pre-flight (D4) re-runs on every keystroke, exactly like
 *   `RevertDialog.vue`'s mainline picker re-runs `previewRevertMainline` — this dialog never lets
 *   `runWorktreeAdd` spawn against a blocked combination the user can already see is blocked.
 * - **prepare** — shown automatically right after a successful create, IFF `prepareScript` (this
 *   repository's own stored `kiraSpace.worktree.prepareScript`) is non-empty. The full script
 *   text is always shown here before it can run (D11's own "never runs anything the user has not
 *   seen"). The server's own approval record is a security-critical implementation detail this
 *   dialog structurally cannot read (D11/F15: the sha is server-only, absent from every wire
 *   shape) — so `sessionApprovedHash` tracks, PURELY CLIENT-SIDE and only for THIS webview's own
 *   lifetime, which exact script text this session has already run successfully at least once;
 *   the "Run" checkbox defaults on only when the CURRENT script's own hash matches that value,
 *   otherwise it defaults off and the user must tick it explicitly — never assuming a state this
 *   dialog cannot actually observe. Once running, output streams live (`ops.
 *   worktreePrepareOutput`) with a Cancel button; dismissing the dialog while it runs does not
 *   cancel it — `AppToolbar.vue`'s own strip takes over as the visible indicator (D13).
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now, `title` feeds
 * `DialogTitle`'s default slot, and the create phase's mode picker/text fields/checkbox are
 * RadioGroup/Input/Checkbox.
 */
import { validateRefName } from '@kira/git-core';
import type { WorktreeAddPreflight } from '@kira/git-ipc';
import ScriptProgress from '@theme/components/ScriptProgress.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import type { RefsState } from '../../state/refs.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../../state/worktrees.ts';
import PrepareOutput from '../PrepareOutput.vue';

const props = defineProps<{
  worktrees: WorktreeState;
  ops: OpsState;
  refs: RefsState;
  /** Set by `AppToolbar.vue`'s "Create Worktree…" button, the `createWorktree` palette action, or
   *  a "Create worktree here…" row action (P76 §8/§9), via `App.vue`. A fresh object (even `{}`)
   *  opens the create phase and re-seeds it; `undefined` closes it. Watched by reference rather
   *  than a boolean so a second row action re-seeds even while the dialog is already open. */
  createRequest: WorktreeCreateSeed | undefined;
  /** `kiraSpace.worktree.basePath`'s current value — pre-fills the path field's own directory
   *  (D10); pure UX, never validated as an existing directory. */
  basePathDefault: string;
  /** This repository's own stored `kiraSpace.worktree.prepareScript` — "" means the feature is
   *  off, and the prepare phase is skipped entirely after a successful create. */
  prepareScript: string;
  /** `capabilities.runPrepareScript` (D14) — false when the host (Kira Space's native window)
   *  refuses running arbitrary scripts outright. When false, the prepare phase still shows the
   *  script (transparency costs nothing) but offers no way to run it. */
  runPrepareScriptCapability: boolean;
}>();

const emit = defineEmits<(e: 'close-create') => void>();

type Phase = 'create' | 'prepare' | undefined;

const worktreeCreated = ref<string | undefined>(undefined);
const phase = computed<Phase>(() => {
  if (worktreeCreated.value !== undefined) return 'prepare';
  if (props.createRequest !== undefined) return 'create';
  return undefined;
});
const active = computed(() => phase.value !== undefined);

// ---------------------------------------------------------------------------------------
// create phase
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
    worktreeCreated.value = undefined;
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
  if (props.prepareScript.trim() === '') {
    emit('close-create');
    return;
  }
  worktreeCreated.value = trimmedPath;
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
  if (props.prepareScript.trim() === '') {
    emit('close-create');
    return;
  }
  worktreeCreated.value = trimmedPath;
}

// ---------------------------------------------------------------------------------------
// prepare phase (D9-D14)
// ---------------------------------------------------------------------------------------

/** Purely client-side, purely this session's own memory (this file's own doc comment above) —
 *  never persisted, never read from or written to any server-side state. */
const sessionApprovedHash = ref<string | undefined>(undefined);
const scriptHash = ref<string | undefined>(undefined);
const runChecked = ref(false);
const started = ref(false);

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

watch(worktreeCreated, async (createdPath) => {
  if (createdPath === undefined) {
    started.value = false;
    scriptHash.value = undefined;
    return;
  }
  const hash = await sha256Hex(props.prepareScript);
  scriptHash.value = hash;
  runChecked.value = props.runPrepareScriptCapability && sessionApprovedHash.value === hash;
});

const preparing = computed(
  () => props.ops.activeWorktreePreparePath.value === worktreeCreated.value,
);
const prepareResult = computed(() => props.ops.worktreePrepareResult.value);

const prepareState = computed<'running' | 'ready' | 'failed'>(() => {
  if (preparing.value) return 'running';
  return prepareResult.value?.ok === true ? 'ready' : 'failed';
});
const prepareTitle = computed(() => {
  const r = prepareResult.value;
  if (preparing.value) return 'Running prepare script';
  if (r?.ok) return 'Prepare script finished';
  if (r?.cancelled) return 'Prepare script cancelled';
  return 'Prepare script failed';
});
const prepareNote = computed(() => {
  const r = prepareResult.value;
  if (r === undefined || r.ok || r.cancelled) return undefined;
  if (r.timedOut) return 'Timed out';
  return r.error?.message || `Exited with status ${r.exitCode}`;
});

async function startPrepare(): Promise<void> {
  const createdPath = worktreeCreated.value;
  const hash = scriptHash.value;
  if (createdPath === undefined || hash === undefined || !runChecked.value) return;
  started.value = true;
  const result = await props.ops.runWorktreePrepare(createdPath, hash);
  if (result?.ok) sessionApprovedHash.value = hash;
}

function cancelPrepare(): void {
  void props.ops.cancelWorktreePrepare();
}

function skipPrepare(): void {
  emit('close-create');
}

function finishPrepare(): void {
  props.ops.dismissWorktreePrepareResult();
  emit('close-create');
}

const title = computed(() => {
  if (phase.value === 'create') return 'Create worktree';
  if (phase.value === 'prepare') return 'Run prepare script';
  return '';
});

function onClose(): void {
  if (phase.value === 'create') cancelCreate();
  // Dismissing during 'prepare' — running or not — never cancels the script (this file's own doc
  // comment above); it just closes the dialog, same as clicking through it normally.
  else emit('close-create');
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && onClose()">
    <DialogContent
      :show-close-button="false"
      :aria-describedby="undefined"
      class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto">
        <template v-if="phase === 'create'">
          <label :for="pathId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
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
          <fieldset class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
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

          <label v-if="mode === 'existingBranch'" :for="branchId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
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
            <label :for="branchId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
              New branch name
              <Input :id="branchId" v-model="branch" type="text" size="kira" class="w-full" placeholder="feature/x" />
            </label>
            <p v-if="newBranchNameError" class="kv:text-diff-deleted kv:my-0.5">{{ newBranchNameError }}</p>
            <label :for="startPointId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
              Start point
              <Input :id="startPointId" v-model="startPoint" type="text" size="kira" class="w-full" placeholder="main" />
            </label>
          </template>
          <label v-else :for="startPointId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
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
            <p v-for="blocker in preflight.blockers" :key="blocker.kind" class="kv:text-diff-deleted kv:my-0.5">
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
            <p v-if="canOfferDetachHere" class="kv:text-diff-deleted">
              The new worktree will start with a detached HEAD.
            </p>
            <Button v-if="canOfferDetachHere" variant="dialog-primary" size="kira-lg" @click="submitCreateDetached">
              Create it detached at that branch's commit
            </Button>
            <p v-for="note in preflight.notes" :key="note.kind" class="kv:text-diff-deleted">
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

        <template v-else-if="phase === 'prepare'">
          <p class="kv:text-diff-deleted">Worktree created at <code>{{ worktreeCreated }}</code>.</p>
          <template v-if="!started">
            <p>This repository has a prepare script:</p>
            <pre class="kv:max-h-60 kv:overflow-y-auto kv:p-1 kv:bg-panel kv:border kv:border-panel-border kv:font-data kv:text-sm kv:whitespace-pre-wrap kv:break-all">{{ prepareScript }}</pre>
            <p v-if="!runPrepareScriptCapability" class="kv:text-diff-deleted kv:my-0.5">
              Running scripts is disabled here.
            </p>
            <Label v-else class="flex flex-row items-center gap-1">
              <Checkbox v-model="runChecked" />
              Run this script now, as your own shell, with your own permissions
            </Label>
          </template>
          <template v-else>
            <ScriptProgress
              :state="prepareState"
              :title="prepareTitle"
              :started-at="ops.worktreePrepareStartedAt.value ?? 0"
              :finished-at="ops.worktreePrepareFinishedAt.value"
              :note="prepareNote"
            >
              <PrepareOutput :lines="ops.worktreePrepareOutput.value" />
            </ScriptProgress>
          </template>
        </template>
      </div>

      <DialogFooter class="justify-end gap-1">
        <template v-if="phase === 'create'">
          <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmitCreate" @click="submitCreate">
            Create
          </Button>
          <Button variant="dialog" size="kira-lg" @click="cancelCreate">Cancel</Button>
        </template>
        <template v-else-if="phase === 'prepare' && !started">
          <Button
            variant="dialog-primary"
            size="kira-lg"
            :disabled="!runChecked || !runPrepareScriptCapability"
            @click="startPrepare"
          >
            Run
          </Button>
          <Button variant="dialog" size="kira-lg" @click="skipPrepare">Skip</Button>
        </template>
        <template v-else-if="phase === 'prepare' && preparing">
          <Button variant="dialog" size="kira-lg" @click="cancelPrepare">Cancel</Button>
        </template>
        <template v-else-if="phase === 'prepare'">
          <Button variant="dialog-primary" size="kira-lg" @click="finishPrepare">Close</Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
