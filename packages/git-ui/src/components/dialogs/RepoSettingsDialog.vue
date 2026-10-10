<script setup lang="ts">
/**
 * G18 D13: "Repository settings" — the dialog `AppToolbar.vue`'s own gear (`⚙`, D13) opens.
 * Each field here is hand-written, not schema-driven (no loop over `repoSettingKeys()`) — a new
 * `source: 'repo'` leaf needs an explicit field/patch-diff line added here, same as every leaf
 * already present. `kiraSpace.worktree.prepareScript`/`.basePath` (G25) are the two `'repo'`
 * leaves this dialog deliberately does NOT surface. The prepare script is read-only in git-ui and
 * set in Kira Space (P172); `WorktreeDialog.vue` only reads it. G28 D16 adds
 * `kiraSpace.checkout.autoStash`, its own new "Checkout" section.
 *
 * Mirrors `StashDialog.vue`'s own "one instance, `open` prop + `close` emit" convention — the
 * whole per-repo settings surface fits in one dialog the same way stash's create/branch/popConfirm
 * three modes do, so this is a second file in that shape, not a fourth mode grafted onto
 * `StashDialog.vue` itself (a settings dialog and a stash workflow share no state).
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now. Every
 * `KuiSelect` is `NativeSelect` (git-ui has no fancier dropdown primitive — same choice
 * `StackDialog.vue`'s own parent picker makes), each still driven by an explicit
 * `onXChange`-and-cast handler rather than a plain `v-model`, since `NativeSelect`'s own
 * `modelValue` type (`AcceptableValue`) is wider than any one of these settings' own narrow
 * union. The page-size field is `NumberStepperInput` with a manual `Number(...)` cast on
 * `update:model-value` — a component `v-model` has no `.number` auto-cast (Vue only applies it to
 * a native element).
 */
import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
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
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { computed, reactive, ref, useId, watch } from 'vue';
import type { RepoSettingsState } from '../../state/repoSettings.ts';

const props = defineProps<{
  open: boolean;
  repoSettingsState: RepoSettingsState;
}>();

const emit = defineEmits<(e: 'close') => void>();

type SelectOption = { readonly value: string; readonly label: string };

/** `RepoSettingsSnapshot`'s own leaves are `readonly` (a wire type is never a mutation target) —
 *  this dialog's draft needs a genuinely mutable copy of the same shape for `v-model` to write
 *  into. */
type RepoSettingsDraft = { -readonly [K in keyof RepoSettingsSnapshot]: RepoSettingsSnapshot[K] };

/** A local, editable draft — reset from the live snapshot every time the dialog opens (the same
 *  "re-read fresh every time it opens" shape `StashDialog.vue`'s own `includeUntrackedDefault`
 *  prop doc comment already follows), so an edit in progress here never fights a
 *  `repoSettings.changed` event arriving mid-edit from somewhere else (App.vue window resize,
 *  another window's own write) — the live snapshot keeps updating underneath; this draft only
 *  catches up with it at open time, not on every tick. */
const draft = reactive<RepoSettingsDraft>({ ...props.repoSettingsState.settings.value });
// The snapshot the draft was copied from: `save()` diffs against it, so a field the user did not
// edit is never written back over a newer value another surface set meanwhile.
let draftBase: RepoSettingsSnapshot = props.repoSettingsState.settings.value;
const saveError = ref<string | undefined>(undefined);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    draftBase = props.repoSettingsState.settings.value;
    Object.assign(draft, draftBase);
    saveError.value = undefined;
  },
);

const baseCandidatesText = computed({
  get: () => draft['kiraSpace.review.baseCandidates'].join('\n'),
  set: (value: string) => {
    draft['kiraSpace.review.baseCandidates'] = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  },
});

const graphScopeOptions: readonly SelectOption[] = [
  { value: 'all', label: 'All refs' },
  { value: 'head', label: "Current HEAD's ancestry only" },
];

const pullStrategyOptions: readonly SelectOption[] = [
  { value: 'auto', label: 'Auto (follow git configuration)' },
  { value: 'ff-only', label: 'Fast-forward only' },
  { value: 'merge', label: 'Merge' },
  { value: 'rebase', label: 'Rebase' },
];

function onGraphScopeChange(value: string): void {
  draft['kiraSpace.graph.scope'] = value as RepoSettingsSnapshot['kiraSpace.graph.scope'];
}

function onPullStrategyChange(value: string): void {
  draft['kiraSpace.pull.strategy'] = value as RepoSettingsSnapshot['kiraSpace.pull.strategy'];
}

function onPageSizeChange(value: string | number): void {
  // An emptied field is NaN, not 0: it fails `pageSizeValid` rather than saving a bogus value.
  draft['kiraSpace.graph.pageSize'] = value === '' ? Number.NaN : Number(value);
}

const pageSizeText = computed(() => {
  const size = draft['kiraSpace.graph.pageSize'];
  return Number.isNaN(size) ? '' : String(size);
});

const pageSizeValid = computed(() => {
  const size = draft['kiraSpace.graph.pageSize'];
  const { minimum, maximum } = SETTINGS['kiraSpace.graph.pageSize'];
  return Number.isInteger(size) && size >= minimum && size <= maximum;
});

const pageSizeId = useId();
const autoStashId = useId();
const showInGraphId = useId();
const includeUntrackedId = useId();
const githubId = useId();
const graphScopeId = useId();
const baseCandidatesId = useId();
const pullStrategyId = useId();

function close(): void {
  emit('close');
}

async function save(): Promise<void> {
  if (!pageSizeValid.value) return;
  const current = draftBase;
  const patch: { -readonly [K in keyof RepoSettingsPatch]: RepoSettingsPatch[K] } = {};
  if (draft['kiraSpace.graph.pageSize'] !== current['kiraSpace.graph.pageSize']) {
    patch['kiraSpace.graph.pageSize'] = draft['kiraSpace.graph.pageSize'];
  }
  if (draft['kiraSpace.graph.scope'] !== current['kiraSpace.graph.scope']) {
    patch['kiraSpace.graph.scope'] = draft['kiraSpace.graph.scope'];
  }
  if (draft['kiraSpace.checkout.autoStash'] !== current['kiraSpace.checkout.autoStash']) {
    patch['kiraSpace.checkout.autoStash'] = draft['kiraSpace.checkout.autoStash'];
  }
  if (draft['kiraSpace.stash.showInGraph'] !== current['kiraSpace.stash.showInGraph']) {
    patch['kiraSpace.stash.showInGraph'] = draft['kiraSpace.stash.showInGraph'];
  }
  if (
    draft['kiraSpace.stash.includeUntracked'] !== current['kiraSpace.stash.includeUntracked']
  ) {
    patch['kiraSpace.stash.includeUntracked'] = draft['kiraSpace.stash.includeUntracked'];
  }
  if (
    draft['kiraSpace.review.baseCandidates'].join('\n') !==
    current['kiraSpace.review.baseCandidates'].join('\n')
  ) {
    patch['kiraSpace.review.baseCandidates'] = [...draft['kiraSpace.review.baseCandidates']];
  }
  if (draft['kiraSpace.pull.strategy'] !== current['kiraSpace.pull.strategy']) {
    patch['kiraSpace.pull.strategy'] = draft['kiraSpace.pull.strategy'];
  }
  if (draft['kiraSpace.github.enabled'] !== current['kiraSpace.github.enabled']) {
    patch['kiraSpace.github.enabled'] = draft['kiraSpace.github.enabled'];
  }
  if (Object.keys(patch).length > 0) {
    try {
      await props.repoSettingsState.set(patch);
    } catch (err) {
      saveError.value = err instanceof Error ? err.message : String(err);
      return;
    }
  }
  close();
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && close()">
    <DialogContent
      :aria-describedby="undefined"
      size="md"
    >
      <DialogHeader closable>
        <DialogTitle>Repository settings</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FieldSet>
          <FieldLegend>Graph</FieldLegend>
          <Field>
            <FieldLabel :for="pageSizeId">Load more page size</FieldLabel>
            <NumberStepperInput
              :id="pageSizeId"
              :model-value="pageSizeText"
              group-class="h-control w-32"
              :min="SETTINGS['kiraSpace.graph.pageSize'].minimum"
              :max="SETTINGS['kiraSpace.graph.pageSize'].maximum"
              :aria-invalid="!pageSizeValid"
              @update:model-value="onPageSizeChange"
            />
            <FieldError v-if="!pageSizeValid">
              Enter a whole number from {{ SETTINGS['kiraSpace.graph.pageSize'].minimum }} to
              {{ SETTINGS['kiraSpace.graph.pageSize'].maximum }}.
            </FieldError>
          </Field>
          <Field>
            <FieldLabel :for="graphScopeId">Scope</FieldLabel>
            <NativeSelect
              :id="graphScopeId"
              :model-value="draft['kiraSpace.graph.scope']"
              variant="bordered"
              size="kira-lg"
              class="w-full"
              @update:model-value="(v) => onGraphScopeChange(v as string)"
            >
              <option v-for="opt in graphScopeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </NativeSelect>
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Checkout</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox :id="autoStashId" v-model="draft['kiraSpace.checkout.autoStash']" />
            <FieldLabel :for="autoStashId">
              Automatically stash local changes that block a branch switch
            </FieldLabel>
          </Field>
          <FieldDescription>
            The stash is tagged with the branch you switched FROM and is never popped back
            automatically — bring it back deliberately from the stash list, even onto a different
            branch. Off restores the old dialog (discard / stash and carry / cancel).
          </FieldDescription>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Stash</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox :id="showInGraphId" v-model="draft['kiraSpace.stash.showInGraph']" />
            <FieldLabel :for="showInGraphId">Show stash entries as nodes in the commit graph</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox :id="includeUntrackedId" v-model="draft['kiraSpace.stash.includeUntracked']" />
            <FieldLabel :for="includeUntrackedId">
              "Include untracked files" starts checked in the Stash dialog
            </FieldLabel>
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Branch review</FieldLegend>
          <Field>
            <FieldLabel :for="baseCandidatesId">
              Candidate base branches (one per line, tried in order)
            </FieldLabel>
            <Textarea :id="baseCandidatesId" v-model="baseCandidatesText" rows="3" class="w-full" />
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend>GitHub</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox :id="githubId" v-model="draft['kiraSpace.github.enabled']" />
            <FieldLabel :for="githubId">Show pull request status for this repository</FieldLabel>
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Pull</FieldLegend>
          <Field>
            <FieldLabel :for="pullStrategyId">Strategy</FieldLabel>
            <NativeSelect
              :id="pullStrategyId"
              :model-value="draft['kiraSpace.pull.strategy']"
              variant="bordered"
              size="kira-lg"
              class="w-full"
              @update:model-value="(v) => onPullStrategyChange(v as string)"
            >
              <option v-for="opt in pullStrategyOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </NativeSelect>
          </Field>
        </FieldSet>

        <Alert v-if="saveError" variant="destructive">
          <AlertDescription>Couldn't save settings — {{ saveError }}</AlertDescription>
        </Alert>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" @click="close">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!pageSizeValid" @click="save">
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
