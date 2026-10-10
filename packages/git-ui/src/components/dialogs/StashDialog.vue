<script setup lang="ts">
/**
 * `docs/plans/P9.md` W14 (§3.1's normative tree names exactly one `StashDialog.vue`, unlike
 * `BranchDialog.vue`/`TagDialog.vue`/`RevertDialog.vue`'s one-dialog-per-file precedent — see this
 * plan's own Findings for why all three of its "collect input" moments live in this one file
 * rather than being split further to match that precedent):
 *
 * - **create** — `runStashPush`'s own confirm step (no pre-flight endpoint exists for it).
 * - **branch** — name entry plus `previewStashBranch`'s live pre-flight, re-run on every keystroke
 *   exactly like `RevertDialog.vue`'s own mainline picker re-runs `previewRevertMainline`.
 * - **popConfirm** — the shared apply/pop confirmation (OQ7), driven directly by
 *   `ops.pendingStashPop` with no props of its own, exactly like `RevertDialog.vue`/
 *   `CheckoutDialog.vue` are driven by their own `ops.pending*` fields.
 *
 * At most one mode is ever active — `mode` below picks in that order (create/branch never overlap
 * `popConfirm` in practice, since `previewStashBranch` never opens `ops.pendingStashPop`, but the
 * order still matters if a caller opened `createOpen`/`branchTarget` while a pop confirmation from
 * an unrelated row happened to already be pending).
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now, `title` feeds
 * `DialogTitle`'s default slot, and the four modes' own controls are Input/Checkbox/RadioGroup —
 * `mode`/`onClose`'s own dispatch is otherwise unchanged.
 */
import { validateRefName } from '@kira/git-core';
import type { StashBranchPreflight, StashEntry } from '@kira/git-ipc';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import { stashLabel } from '../stashListModel.ts';

const props = defineProps<{
  ops: OpsState;
  /** Toggled by `AppToolbar.vue`'s "Stash" button, via `App.vue`. */
  createOpen: boolean;
  /** `kiraSpace.stash.includeUntracked`'s current value — the create form's own default,
   *  re-read fresh every time the dialog opens (a setting change mid-session should be seen the
   *  next time this opens, not only after a reload). */
  includeUntrackedDefault: boolean;
  /** Set by `StashList.vue`'s "Create branch from stash…" row action, via `BranchPicker.vue` →
   *  `App.vue`; `undefined` when branch mode is not open. */
  branchTarget: StashEntry | undefined;
  /** G28 D13: toggled by the global-stash section's own header button and the palette's
   *  `saveGlobalStash` action, via `App.vue` — opens save mode with NO pre-selected source
   *  (defaults to "this working tree"). */
  saveOpen: boolean;
  /** G28 D13: set by a STACK row's own "Save to global stash…" action — opens save mode
   *  pre-selected to promote THIS entry (D10 step 3); `undefined` when that row action was not
   *  the trigger (the header button/palette route sets `saveOpen` instead, leaving this
   *  `undefined`, and the source radio then defaults to "this working tree"). */
  saveSourceEntry: StashEntry | undefined;
}>();

const emit = defineEmits<{
  (e: 'close-create'): void;
  (e: 'close-branch'): void;
  (e: 'close-save'): void;
}>();

type Mode = 'create' | 'branch' | 'save' | 'popConfirm' | undefined;

const mode = computed<Mode>(() => {
  if (props.ops.pendingStashPop.value) return 'popConfirm';
  if (props.branchTarget !== undefined) return 'branch';
  if (props.saveOpen || props.saveSourceEntry !== undefined) return 'save';
  if (props.createOpen) return 'create';
  return undefined;
});

const active = computed(() => mode.value !== undefined);

// ---------------------------------------------------------------------------------------
// create mode
// ---------------------------------------------------------------------------------------

const message = ref('');
const includeUntracked = ref(props.includeUntrackedDefault);
const keepIndex = ref(false);
const messageId = useId();
const untrackedId = useId();
const keepIndexId = useId();
/** OQ9: wired from the caller's current changed-files selection when non-empty (`App.vue` passes
 *  it through `createOpen`'s own open call — see that wiring's own comment); empty means "whole
 *  worktree", never a half-wired guess. Shown here as a read-only summary, not an editable field —
 *  there is no staging UI in this app to pick a *different* subset from. */
const pathspec = ref<readonly string[]>([]);

watch(
  () => props.createOpen,
  (isOpen) => {
    if (!isOpen) return;
    message.value = '';
    includeUntracked.value = props.includeUntrackedDefault;
    keepIndex.value = false;
  },
);

function cancelCreate(): void {
  emit('close-create');
}

async function submitCreate(): Promise<void> {
  const result = await props.ops.runStashPush({
    message: message.value.trim() === '' ? undefined : message.value.trim(),
    includeUntracked: includeUntracked.value,
    keepIndex: keepIndex.value,
    // `[...pathspec.value]` (not `pathspec.value` itself): `ref<readonly string[]>`'s own value is
    // a reactive `Proxy`-wrapped array (Vue's `toReactive`), and `mockBridge.ts`'s in-memory pipe
    // genuinely `structuredClone`s every request to mimic real `postMessage` — Chromium's
    // structured-clone algorithm rejects a `Proxy` outright ("[object Object] could not be
    // cloned"), even an empty one, regardless of what it wraps. A plain array copy is the one this
    // request needs; nothing here relies on the reactive wrapper past this call.
    paths: [...pathspec.value],
  });
  if (!result.ok) return;
  emit('close-create');
}

// ---------------------------------------------------------------------------------------
// branch mode
// ---------------------------------------------------------------------------------------

const branchName = ref('');
const branchPreflight = ref<StashBranchPreflight | undefined>(undefined);
const branchNameId = useId();
let previewToken = 0;

watch(
  () => props.branchTarget,
  (entry) => {
    if (entry === undefined) return;
    branchName.value = '';
    branchPreflight.value = undefined;
  },
);

watch(branchName, async (name) => {
  const entry = props.branchTarget;
  const trimmed = name.trim();
  if (entry === undefined || trimmed === '') {
    branchPreflight.value = undefined;
    return;
  }
  const token = ++previewToken;
  const result = await props.ops.previewStashBranch(entry, trimmed);
  // A later keystroke's own preview may have already resolved and been rendered by the time this
  // one comes back — `previewRevertMainline`'s call sites have no comparable race (a mainline
  // pick fires once, not once per keystroke), so this dialog needs its own guard against a slow,
  // stale response clobbering a newer one.
  if (token === previewToken) branchPreflight.value = result;
});

const branchNameLocalError = computed(() => {
  if (branchName.value.trim() === '') return undefined;
  const { valid, error } = validateRefName(branchName.value.trim());
  return valid ? undefined : error;
});

/** Only a genuinely invalid/taken name (or nothing typed yet) blocks the button — a `blocked`
 *  checkout half (OQ6) still lets the user create the branch; §7.6/probe 11's own point is that
 *  the branch creation always succeeds, only the pop half can fail, and OQ6's recommendation is to
 *  say so plainly afterward rather than refuse the attempt up front. */
const canSubmitBranch = computed(
  () =>
    branchName.value.trim() !== '' &&
    branchNameLocalError.value === undefined &&
    branchPreflight.value !== undefined &&
    branchPreflight.value.verdict !== 'invalidName',
);

function cancelBranch(): void {
  emit('close-branch');
}

async function submitBranch(): Promise<void> {
  const entry = props.branchTarget;
  if (entry === undefined || !canSubmitBranch.value) return;
  const result = await props.ops.runStashBranch(entry, branchName.value.trim());
  if (!result.ok) return;
  emit('close-branch');
}

// ---------------------------------------------------------------------------------------
// save mode (G28 D13/D10): two sources, the dialog is the confirm step (no pre-flight endpoint
// exists for globalStashSave, same reason create mode has none), and the one thing worth showing
// up front is F14's own limitation — `git stash create` cannot include untracked files, so the
// working-tree source is spelled out as tracked-only rather than hiding the gap.
// ---------------------------------------------------------------------------------------

type SaveSource = 'workingTree' | 'entry';

const saveLabel = ref('');
const saveSource = ref<SaveSource>('workingTree');
const saveLabelId = useId();
const saveSourceId = useId();

watch(
  () => [props.saveOpen, props.saveSourceEntry] as const,
  ([isOpen, entry]) => {
    if (!isOpen && entry === undefined) return;
    saveLabel.value = '';
    // Pre-selected to "this stash entry" when opened from a stack row (D13); otherwise "this
    // working tree" — the radio itself stays changeable either way, this only sets the default.
    saveSource.value = entry !== undefined ? 'entry' : 'workingTree';
  },
);

/** F14: the working-tree source's own tracked-only limitation is spelled out whenever there is
 *  something it would actually miss, rather than unconditionally — a warning that is always true
 *  reads as noise. */
const saveHasUntracked = computed(() => (props.ops.statusSummary.value?.counts.untracked ?? 0) > 0);

const canSubmitSave = computed(
  () => saveLabel.value.trim() !== '' && !/[\r\n]/.test(saveLabel.value),
);

function cancelSave(): void {
  emit('close-save');
}

async function submitSave(): Promise<void> {
  if (!canSubmitSave.value) return;
  const sha = saveSource.value === 'entry' ? props.saveSourceEntry?.sha : undefined;
  const result = await props.ops.runGlobalStashSave(saveLabel.value.trim(), sha);
  if (!result.ok) return;
  emit('close-save');
}

// ---------------------------------------------------------------------------------------
// popConfirm mode (OQ7: one dialog, verb and one sentence differ)
// ---------------------------------------------------------------------------------------

const pending = computed(() => props.ops.pendingStashPop.value);

function cancelPop(): void {
  props.ops.resolveStashPopDialog(false);
}

function confirmPop(): void {
  props.ops.resolveStashPopDialog(true);
}

// ---------------------------------------------------------------------------------------
// mode-dispatched title / close, for the one shared dialog shell
// ---------------------------------------------------------------------------------------

const title = computed(() => {
  if (mode.value === 'create') return 'Stash changes';
  if (mode.value === 'branch') return 'Create branch from stash';
  if (mode.value === 'save') return 'Save to global stash';
  if (mode.value === 'popConfirm' && pending.value) {
    return `${pending.value.verb === 'pop' ? 'Pop' : 'Apply'} stash@{${pending.value.preflight.stashIndex}}`;
  }
  return '';
});

function onClose(): void {
  if (mode.value === 'create') cancelCreate();
  else if (mode.value === 'branch') cancelBranch();
  else if (mode.value === 'save') cancelSave();
  else if (mode.value === 'popConfirm') cancelPop();
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && onClose()">
    <DialogContent
      :aria-describedby="undefined"
      size="md"
    >
      <DialogHeader closable>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <template v-if="mode === 'create'">
          <Field>
            <FieldLabel :for="messageId">Message (optional)</FieldLabel>
            <Input
              :id="messageId"
              v-model="message"
              type="text"
              size="kira-lg"
              class="w-full"
              placeholder="git's own WIP message"
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox :id="untrackedId" v-model="includeUntracked" />
            <FieldLabel :for="untrackedId">
              <span>Include untracked files (<code class="font-data">-u</code>)</span>
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox :id="keepIndexId" v-model="keepIndex" />
            <FieldLabel :for="keepIndexId">
              <span>Keep staged changes staged (<code class="font-data">--keep-index</code>)</span>
            </FieldLabel>
          </Field>
          <FieldDescription v-if="pathspec.length > 0">
            Only {{ pathspec.length }} selected file{{ pathspec.length === 1 ? '' : 's' }} will be
            stashed, not the whole working tree.
          </FieldDescription>
        </template>

        <template v-else-if="mode === 'branch'">
          <FieldDescription>
            From <code class="font-data">{{
              // A template literal here would put two closing braces back to back, which this Vue
              // parser reads as the mustache's own closing delimiter mid-expression.
              // biome-ignore lint/style/useTemplate: see above
              'stash@{' + (branchTarget?.index ?? '') + '}'
            }}</code>:
            {{ branchTarget?.message }}
          </FieldDescription>
          <Field>
            <FieldLabel :for="branchNameId">Branch name</FieldLabel>
            <Input :id="branchNameId" v-model="branchName" type="text" size="kira-lg" class="w-full" />
            <FieldError v-if="branchNameLocalError">{{ branchNameLocalError }}</FieldError>
            <FieldError v-else-if="branchPreflight?.name.error">{{ branchPreflight.name.error }}</FieldError>
          </Field>
          <Alert v-if="branchPreflight?.verdict === 'blocked'" variant="warn">
            <AlertDescription>
              The branch will be created, but switching to it will not be clean — your working tree
              has changes that would be overwritten. You will stay on your current branch until you
              resolve that yourself.
            </AlertDescription>
          </Alert>
        </template>

        <template v-else-if="mode === 'save'">
          <Field>
            <FieldLabel :for="saveLabelId">Label</FieldLabel>
            <Input :id="saveLabelId" v-model="saveLabel" type="text" size="kira-lg" class="w-full" />
          </Field>
          <FieldSet>
            <FieldLegend>Source</FieldLegend>
            <RadioGroup v-model="saveSource">
              <Field orientation="horizontal">
                <RadioGroupItem :id="`${saveSourceId}-workingTree`" value="workingTree" />
                <FieldLabel :for="`${saveSourceId}-workingTree`">This working tree</FieldLabel>
              </Field>
              <Alert v-if="saveSource === 'workingTree' && saveHasUntracked" variant="warn">
                <AlertDescription>
                  Untracked files will not be included — <code class="font-data">git stash create</code> cannot save them.
                  Promote an existing stash entry that already includes them instead if you need to keep
                  those too.
                </AlertDescription>
              </Alert>
              <Field v-if="saveSourceEntry" orientation="horizontal">
                <RadioGroupItem :id="`${saveSourceId}-entry`" value="entry" />
                <FieldLabel :for="`${saveSourceId}-entry`">
                  This stash entry: {{ stashLabel(saveSourceEntry) }}
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
          <FieldDescription>The source is copied — it is never removed or dropped.</FieldDescription>
        </template>

        <template v-else-if="mode === 'popConfirm' && pending">
          <template v-for="blocker in pending.preflight.blockers" :key="blocker.kind">
            <Alert v-if="blocker.kind === 'untrackedCollision'" variant="warn"><AlertDescription>
              <p>These untracked files already exist in your working tree and would be overwritten:</p>
              <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
                <li v-for="path in blocker.paths" :key="path"><code class="font-data">{{ path }}</code></li>
              </ul>
              <p>Remedy: move or remove them yourself, or discard them and try again.</p>
            </AlertDescription></Alert>
            <Alert v-else-if="blocker.kind === 'localChangesWouldBeOverwritten'" variant="warn"><AlertDescription>
              <p>Your uncommitted changes to these files would be overwritten:</p>
              <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
                <li v-for="path in blocker.paths" :key="path"><code class="font-data">{{ path }}</code></li>
              </ul>
              <p>Remedy: commit or discard those changes first.</p>
            </AlertDescription></Alert>
            <Alert v-else variant="warn">
              <AlertDescription>An operation is already in progress — finish or abort it first.</AlertDescription>
            </Alert>
          </template>

          <template v-if="pending.preflight.blockers.length === 0">
            <div
              v-if="pending.preflight.prediction.kind === 'clean'"
              class="text-ok"
            >
              No conflicts predicted.
            </div>
            <Alert v-else-if="pending.preflight.prediction.kind === 'conflicts'" variant="warn"><AlertDescription>
              <p>This will likely conflict in:</p>
              <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
                <li v-for="path in pending.preflight.prediction.paths" :key="path">
                  <code class="font-data">{{ path }}</code>
                </li>
              </ul>
              <p>
                Your stash stays in the list either way{{
                  pending.verb === 'pop' ? ' if this conflicts' : ''
                }}
                — nothing is lost.
              </p>
            </AlertDescription></Alert>
            <FieldDescription v-else>
              Couldn't predict the outcome: {{ pending.preflight.prediction.reason }}
            </FieldDescription>
          </template>
        </template>
      </DialogBody>

      <DialogFooter>
        <template v-if="mode === 'create'">
          <Button variant="dialog" size="kira-lg" @click="cancelCreate">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" @click="submitCreate">Stash</Button>
        </template>
        <template v-else-if="mode === 'branch'">
          <Button variant="dialog" size="kira-lg" @click="cancelBranch">Cancel</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            :disabled="!canSubmitBranch"
            @click="submitBranch"
          >
            Create branch
          </Button>
        </template>
        <template v-else-if="mode === 'save'">
          <Button variant="dialog" size="kira-lg" @click="cancelSave">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmitSave" @click="submitSave">
            Save
          </Button>
        </template>
        <template v-else-if="mode === 'popConfirm' && pending">
          <Button variant="dialog" size="kira-lg" @click="cancelPop">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" @click="confirmPop">
            {{ pending.preflight.verdict === 'blocked' ? 'Force ' : '' }}{{
              pending.verb === 'pop' ? 'Pop' : 'Apply'
            }}
            anyway
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
