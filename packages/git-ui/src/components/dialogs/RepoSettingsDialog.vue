<script setup lang="ts">
/**
 * G18 D13: "Repository settings" — the dialog `AppToolbar.vue`'s own gear (`⚙`, D13) opens.
 * Each field here is hand-written, not schema-driven (no loop over `repoSettingKeys()`) — a new
 * `source: 'repo'` leaf needs an explicit field/patch-diff line added here, same as every leaf
 * already present. `kiraSpace.worktree.prepareScript`/`.basePath` (G25) are the two `'repo'`
 * leaves this dialog deliberately does NOT surface — they are edited from `WorktreeDialog.vue`
 * itself instead, where the prepare-script approval flow they gate lives. G28 D16 adds
 * `kiraSpace.checkout.autoStash`, its own new "Checkout" section.
 *
 * P72 §8.3/§9: `kiraSpace.log.level` **used to not be per-repo** (D14) — a hardcoded sentinel
 * collapse in `gitreposettings.go`, surfaced here as a visible note. Both that collapse and the
 * note are deleted: Kira Space now has its own independent, genuinely app-wide
 * `advanced.gitLogLevel` (`SettingsDialog.vue`), and this leaf reverts to an ordinary per-repo
 * fact, same as `dateFormat` below moved to `appearance.dateFormat` there. Both sections
 * (Display/Diagnostics) are host-conditional (the `host` prop) — shown under `'vscode'`/
 * `'harness'`, since the extension has no app-wide settings dialog of its own and this remains
 * its only surface for either value; hidden under `'kira'`, where Studio's own dialog owns both.
 *
 * Mirrors `StashDialog.vue`'s own "one instance, `open` prop + `close` emit" convention — the
 * whole per-repo settings surface fits in one dialog the same way stash's create/branch/popConfirm
 * three modes do, so this is a second file in that shape, not a fourth mode grafted onto
 * `StashDialog.vue` itself (a settings dialog and a stash workflow share no state).
 *
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content. Its three native `<select>`s are `<KuiSelect>` now too; each one's
 * `update:model-value` payload is the primitive's own plain `string`, cast back to the narrower
 * union `RepoSettingsSnapshot` actually declares (the option `value`s themselves are always one
 * of that union's own members, so the cast is never a lie, just narrower than `KuiSelect`'s own
 * generic-string contract can express).
 *
 * G-UX D8: the **Display** section's `dateFormat` field is a SECOND kind of exception to "hand-
 * written from `RepoSettingsSnapshot`" — it does not live in that snapshot at all
 * (`PersistedViewState` owns it under `'vscode'`/`'harness'`, a view preference, not a repository
 * fact, D8's own rejected alternative explains why) — so it arrives as a plain prop/emit pair and
 * applies immediately, never joining `draft`/`save()`'s patch diff.
 */
import { SETTINGS } from '@kira/git-core';
import type { HostKind, RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
import type { KuiSelectOption } from '@kira/kira-ui';
import { KuiButton, KuiDialog, KuiSelect } from '@kira/kira-ui';
import { computed, reactive, watch } from 'vue';
import type { RepoSettingsState } from '../../state/repoSettings.ts';
import type { DateFormat } from '../../state/viewState.ts';

const props = defineProps<{
  open: boolean;
  repoSettingsState: RepoSettingsState;
  dateFormat: DateFormat;
  /** P72 §8.3: which shell mounted this dialog — 'kira' hides the Display/Diagnostics sections
   *  (Kira Space owns both app-wide now, appearance.dateFormat/advanced.gitLogLevel,
   *  packages/shared/domain/settings.ts), 'vscode'/'harness' keep showing them, since the
   *  extension has no app-wide settings dialog of its own (this dialog is its only surface for
   *  either value, §8.3's own finding). */
  host: HostKind;
  /** C10 §4.4: `false` under the native read-only graph — hides the Pull section (`strategy`
   *  configures `remote.pull`, a write this host's transport never issues). Graph scope/page size
   *  stay: genuine read-side controls, and `repoSettings.set` itself stays allowed at layer 1
   *  (§4.4) since it only ever writes Kira's own SQLite, never the repository. */
  writeCapability: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:dateFormat', value: DateFormat): void;
}>();

const dateFormatOptions: readonly KuiSelectOption[] = [
  { value: 'relative', label: 'Relative (3 days ago)' },
  { value: 'absolute', label: 'Absolute (2024-12-30 22:48)' },
];

function onDateFormatChange(value: string): void {
  emit('update:dateFormat', value as DateFormat);
}

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

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    Object.assign(draft, props.repoSettingsState.settings.value);
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

const graphScopeOptions: readonly KuiSelectOption[] = [
  { value: 'all', label: 'All refs' },
  { value: 'head', label: "Current HEAD's ancestry only" },
];

const pullStrategyOptions: readonly KuiSelectOption[] = [
  { value: 'auto', label: 'Auto (follow git configuration)' },
  { value: 'ff-only', label: 'Fast-forward only' },
  { value: 'merge', label: 'Merge' },
  { value: 'rebase', label: 'Rebase' },
];

const logLevelOptions: readonly KuiSelectOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

function onGraphScopeChange(value: string): void {
  draft['kiraSpace.graph.scope'] = value as RepoSettingsSnapshot['kiraSpace.graph.scope'];
}

function onPullStrategyChange(value: string): void {
  draft['kiraSpace.pull.strategy'] = value as RepoSettingsSnapshot['kiraSpace.pull.strategy'];
}

function onLogLevelChange(value: string): void {
  draft['kiraSpace.log.level'] = value as RepoSettingsSnapshot['kiraSpace.log.level'];
}

function close(): void {
  emit('close');
}

async function save(): Promise<void> {
  const current = props.repoSettingsState.settings.value;
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
  if (draft['kiraSpace.log.level'] !== current['kiraSpace.log.level']) {
    patch['kiraSpace.log.level'] = draft['kiraSpace.log.level'];
  }
  if (draft['kiraSpace.github.enabled'] !== current['kiraSpace.github.enabled']) {
    patch['kiraSpace.github.enabled'] = draft['kiraSpace.github.enabled'];
  }
  if (Object.keys(patch).length > 0) {
    await props.repoSettingsState.set(patch);
  }
  close();
}
</script>

<template>
  <KuiDialog :open="open" title="Repository settings" @close="close">
    <!-- P72 §8.3/§9.1: dateFormat moved to Kira Space's own app-wide appearance.dateFormat
         (SettingsDialog.vue) — Studio owns it there now, so this section is VS Code's only
         remaining surface for it. -->
    <section v-if="host !== 'kira'" class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Display</h3>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1" for="repo-settings-date-format">
        Commit date
        <KuiSelect
          id="repo-settings-date-format"
          :model-value="dateFormat"
          :options="dateFormatOptions"
          @update:model-value="onDateFormatChange"
        />
      </label>
      <p class="kv:text-diff-deleted">This applies to every repository in this panel, not just this one.</p>
    </section>

    <section class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Graph</h3>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
        Load more page size
        <input
          type="number"
          v-model.number="draft['kiraSpace.graph.pageSize']"
          :min="SETTINGS['kiraSpace.graph.pageSize'].minimum"
          :max="SETTINGS['kiraSpace.graph.pageSize'].maximum"
          class="kv:px-1 kv:py-0.5 kv:bg-panel kv:text-row-fg kv:border kv:border-panel-border kv:font-inherit kv:w-[8em]"
        />
      </label>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1" for="repo-settings-graph-scope">
        Scope
        <KuiSelect
          id="repo-settings-graph-scope"
          :model-value="draft['kiraSpace.graph.scope']"
          :options="graphScopeOptions"
          @update:model-value="onGraphScopeChange"
        />
      </label>
    </section>

    <section class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Checkout</h3>
      <label class="kv:flex kv:flex-row kv:items-center kv:gap-0.5 kv:my-1">
        <input type="checkbox" v-model="draft['kiraSpace.checkout.autoStash']" />
        Automatically stash local changes that block a branch switch
      </label>
      <p class="kv:text-diff-deleted">
        The stash is tagged with the branch you switched FROM and is never popped back
        automatically — bring it back deliberately from the stash list, even onto a different
        branch. Off restores the old dialog (discard / stash and carry / cancel).
      </p>
    </section>

    <section class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Stash</h3>
      <label class="kv:flex kv:flex-row kv:items-center kv:gap-0.5 kv:my-1">
        <input type="checkbox" v-model="draft['kiraSpace.stash.showInGraph']" />
        Show stash entries as nodes in the commit graph
      </label>
      <label class="kv:flex kv:flex-row kv:items-center kv:gap-0.5 kv:my-1">
        <input type="checkbox" v-model="draft['kiraSpace.stash.includeUntracked']" />
        "Include untracked files" starts checked in the Stash dialog
      </label>
    </section>

    <section class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Branch review</h3>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
        Candidate base branches (one per line, tried in order)
        <textarea
          v-model="baseCandidatesText"
          rows="3"
          class="kv:px-1 kv:py-0.5 kv:bg-panel kv:text-row-fg kv:border kv:border-panel-border kv:font-inherit"
        ></textarea>
      </label>
    </section>

    <section class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">GitHub</h3>
      <label class="kv:flex kv:flex-row kv:items-center kv:gap-0.5 kv:my-1">
        <input type="checkbox" v-model="draft['kiraSpace.github.enabled']" />
        Show pull request status for this repository
      </label>
    </section>

    <section v-if="writeCapability" class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Pull</h3>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1" for="repo-settings-pull-strategy">
        Strategy
        <KuiSelect
          id="repo-settings-pull-strategy"
          :model-value="draft['kiraSpace.pull.strategy']"
          :options="pullStrategyOptions"
          @update:model-value="onPullStrategyChange"
        />
      </label>
    </section>

    <!-- P72 §8.3/§9.2: Kira Space now has its own independent, genuinely app-wide
         advanced.gitLogLevel (SettingsDialog.vue) — this per-repo leaf is VS Code's only
         remaining surface for log level, and, with D14's cross-repo collapse deleted, it is
         genuinely per-repo again, so no "applies everywhere" note belongs here any more. -->
    <section v-if="host !== 'kira'" class="kv:my-2 kv:first:mt-1">
      <h3 class="kv:m-0 kv:mb-0.5 kv:text-sm kv:font-semibold kv:text-row-fg">Diagnostics</h3>
      <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1" for="repo-settings-log-level">
        Log level
        <KuiSelect
          id="repo-settings-log-level"
          :model-value="draft['kiraSpace.log.level']"
          :options="logLevelOptions"
          @update:model-value="onLogLevelChange"
        />
      </label>
    </section>

    <template #actions>
      <KuiButton variant="primary" @click="save">Save</KuiButton>
      <KuiButton @click="close">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>
