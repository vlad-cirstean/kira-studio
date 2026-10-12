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
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed, ref, useId, watch } from 'vue';
import { renderText } from '../../lib/text.ts';
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
const modeId = useId();
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
  return valid || error === undefined ? undefined : renderText(error);
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

function onClose(): void {
  cancelCreate();
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && onClose()">
    <DialogContent
      :aria-describedby="undefined"
      size="md"
    >
      <DialogHeader>
        <DialogTitle>{{ t('git.dialog.worktree.title') }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <template v-if="active">
          <Field>
            <FieldLabel :for="pathId">{{ t('common.path.label') }}</FieldLabel>
            <Input
              :id="pathId"
              v-model="path"
              type="text"
              size="kira-lg"
              class="w-full"
              :placeholder="t('git.dialog.worktree.path.example')"
            />
          </Field>
          <FieldSet>
            <FieldLegend>{{ t('git.dialog.worktree.startFrom.label') }}</FieldLegend>
            <RadioGroup v-model="mode">
              <Field orientation="horizontal">
                <RadioGroupItem :id="`${modeId}-existingBranch`" value="existingBranch" />
                <FieldLabel :for="`${modeId}-existingBranch`">{{ t('git.dialog.worktree.existingBranch.option') }}</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem :id="`${modeId}-newBranch`" value="newBranch" />
                <FieldLabel :for="`${modeId}-newBranch`">{{ t('git.dialog.worktree.newBranch.option') }}</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem :id="`${modeId}-detach`" value="detach" />
                <FieldLabel :for="`${modeId}-detach`">{{ t('git.dialog.worktree.detach.option') }}</FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>

          <Field v-if="mode === 'existingBranch'">
            <FieldLabel :for="branchId">{{ t('common.field.branch.label') }}</FieldLabel>
            <Input
              :id="branchId"
              v-model="branch"
              type="text"
              size="kira-lg"
              class="w-full"
              list=""
              :placeholder="t('git.dialog.worktree.existingBranch.placeholder')"
            />
            <datalist id="">
              <option v-for="row in refs.branches.value" :key="row.refname" :value="row.shortName" />
            </datalist>
          </Field>
          <template v-else-if="mode === 'newBranch'">
            <Field>
              <FieldLabel :for="branchId">{{ t('git.dialog.worktree.newBranch.label') }}</FieldLabel>
              <Input :id="branchId" v-model="branch" type="text" size="kira-lg" class="w-full" :placeholder="t('git.dialog.worktree.newBranch.example')" />
              <FieldError v-if="newBranchNameError">{{ newBranchNameError }}</FieldError>
            </Field>
            <Field>
              <FieldLabel :for="startPointId">{{ t('git.dialog.worktree.startPoint.label') }}</FieldLabel>
              <Input :id="startPointId" v-model="startPoint" type="text" size="kira-lg" class="w-full" :placeholder="t('git.dialog.worktree.startPoint.example')" />
            </Field>
          </template>
          <Field v-else>
            <FieldLabel :for="startPointId">{{ t('git.dialog.worktree.commitish.label') }}</FieldLabel>
            <Input
              :id="startPointId"
              v-model="startPoint"
              type="text"
              size="kira-lg"
              class="w-full"
              :placeholder="t('git.dialog.worktree.commitish.placeholder')"
            />
          </Field>

          <template v-if="preflight">
            <Alert v-for="blocker in preflight.blockers" :key="blocker.kind" variant="error"><AlertDescription>
              <template v-if="blocker.kind === 'invalidPath'">{{ t('git.dialog.worktree.blocker.invalidPath.error') }}</template>
              <template v-else-if="blocker.kind === 'pathExists'">
                <CatalogText k="git.dialog.worktree.blocker.pathExists.error">
                  <template #path><code class="font-data">{{ blocker.path }}</code></template>
                </CatalogText>
              </template>
              <template v-else-if="blocker.kind === 'branchCheckedOutElsewhere'">
                <CatalogText k="git.dialog.worktree.blocker.checkedOut.error">
                  <template #branch><code class="font-data">{{ blocker.branch }}</code></template>
                  <template #path><code class="font-data">{{ blocker.worktreePath }}</code></template>
                </CatalogText>
              </template>
              <template v-else-if="blocker.kind === 'branchExists'">
                <CatalogText k="git.dialog.worktree.blocker.branchExists.error">
                  <template #branch><code class="font-data">{{ blocker.branch }}</code></template>
                </CatalogText>
              </template>
              <template v-else-if="blocker.kind === 'unknownStartPoint'">
                <CatalogText k="git.dialog.worktree.blocker.unknownStartPoint.error">
                  <template #startPoint><code class="font-data">{{ blocker.startPoint }}</code></template>
                </CatalogText>
              </template>
            </AlertDescription></Alert>
            <Alert v-if="canOfferDetachHere" variant="warn">
              <AlertDescription>{{ t('git.dialog.worktree.detachedHead.hint') }}</AlertDescription>
            </Alert>
            <Button v-if="canOfferDetachHere" variant="dialog-primary" size="kira-lg" @click="submitCreateDetached">
              {{ t('git.dialog.worktree.detachHere.label') }}
            </Button>
            <Alert v-for="note in preflight.notes" :key="note.kind" variant="warn"><AlertDescription>
              <template v-if="note.kind === 'pathInsideRepo'">
                {{ t('git.dialog.worktree.note.insideRepo.hint') }}
              </template>
              <template v-else-if="note.kind === 'parentDirectoryMissing'">
                {{ t('git.dialog.worktree.note.parentMissing.hint') }}
              </template>
              <template v-else-if="note.kind === 'detachedHead'">
                {{ t('git.dialog.worktree.detachedHead.hint') }}
              </template>
            </AlertDescription></Alert>
          </template>
        </template>

      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" @click="cancelCreate">{{ t('common.action.cancel.label') }}</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmitCreate" @click="submitCreate">
          {{ t('common.action.create.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
