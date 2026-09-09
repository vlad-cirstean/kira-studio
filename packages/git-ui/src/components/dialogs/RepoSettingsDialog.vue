<script setup lang="ts">
/**
 * G18 D13: "Repository settings" — the dialog `AppToolbar.vue`'s own gear (`⚙`, D13) opens.
 * Shows exactly the seven `source: 'repo'` settings `schema.ts` declares (D1/D10), nothing else —
 * no read-only leftover section (10.3, resolved). Five sections: Graph, Stash, Branch review,
 * Pull, Diagnostics.
 *
 * **`kiraVersion.log.level` is not actually per-repo** (D14) — its own field carries a visible
 * note, driven by `SETTINGS['kiraVersion.log.level'].instanceWide` rather than a hardcoded flag
 * here (the same "one schema, one place" reason this dialog exists as a second consumer of
 * `schema.ts` at all), so a user who edits it from two different repos' dialogs is told why they
 * see the same value in both rather than being surprised by it.
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
 */
import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
import type { KuiSelectOption } from '@kira/kira-ui';
import { KuiButton, KuiDialog, KuiSelect } from '@kira/kira-ui';
import { computed, reactive, watch } from 'vue';
import type { RepoSettingsState } from '../../state/repoSettings.ts';

const props = defineProps<{
  open: boolean;
  repoSettingsState: RepoSettingsState;
}>();

const emit = defineEmits<(e: 'close') => void>();

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
  get: () => draft['kiraVersion.review.baseCandidates'].join('\n'),
  set: (value: string) => {
    draft['kiraVersion.review.baseCandidates'] = value
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
  draft['kiraVersion.graph.scope'] = value as RepoSettingsSnapshot['kiraVersion.graph.scope'];
}

function onPullStrategyChange(value: string): void {
  draft['kiraVersion.pull.strategy'] = value as RepoSettingsSnapshot['kiraVersion.pull.strategy'];
}

function onLogLevelChange(value: string): void {
  draft['kiraVersion.log.level'] = value as RepoSettingsSnapshot['kiraVersion.log.level'];
}

const logLevelInstanceWide = SETTINGS['kiraVersion.log.level'].instanceWide ?? false;

function close(): void {
  emit('close');
}

async function save(): Promise<void> {
  const current = props.repoSettingsState.settings.value;
  const patch: { -readonly [K in keyof RepoSettingsPatch]: RepoSettingsPatch[K] } = {};
  if (draft['kiraVersion.graph.pageSize'] !== current['kiraVersion.graph.pageSize']) {
    patch['kiraVersion.graph.pageSize'] = draft['kiraVersion.graph.pageSize'];
  }
  if (draft['kiraVersion.graph.scope'] !== current['kiraVersion.graph.scope']) {
    patch['kiraVersion.graph.scope'] = draft['kiraVersion.graph.scope'];
  }
  if (draft['kiraVersion.stash.showInGraph'] !== current['kiraVersion.stash.showInGraph']) {
    patch['kiraVersion.stash.showInGraph'] = draft['kiraVersion.stash.showInGraph'];
  }
  if (
    draft['kiraVersion.stash.includeUntracked'] !== current['kiraVersion.stash.includeUntracked']
  ) {
    patch['kiraVersion.stash.includeUntracked'] = draft['kiraVersion.stash.includeUntracked'];
  }
  if (
    draft['kiraVersion.review.baseCandidates'].join('\n') !==
    current['kiraVersion.review.baseCandidates'].join('\n')
  ) {
    patch['kiraVersion.review.baseCandidates'] = [...draft['kiraVersion.review.baseCandidates']];
  }
  if (draft['kiraVersion.pull.strategy'] !== current['kiraVersion.pull.strategy']) {
    patch['kiraVersion.pull.strategy'] = draft['kiraVersion.pull.strategy'];
  }
  if (draft['kiraVersion.log.level'] !== current['kiraVersion.log.level']) {
    patch['kiraVersion.log.level'] = draft['kiraVersion.log.level'];
  }
  if (draft['kiraVersion.github.enabled'] !== current['kiraVersion.github.enabled']) {
    patch['kiraVersion.github.enabled'] = draft['kiraVersion.github.enabled'];
  }
  if (Object.keys(patch).length > 0) {
    await props.repoSettingsState.set(patch);
  }
  close();
}
</script>

<template>
  <KuiDialog :open="open" title="Repository settings" @close="close">
    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">Graph</h3>
      <label class="kv-dialog-field">
        Load more page size
        <input
          type="number"
          v-model.number="draft['kiraVersion.graph.pageSize']"
          :min="SETTINGS['kiraVersion.graph.pageSize'].minimum"
          :max="SETTINGS['kiraVersion.graph.pageSize'].maximum"
          autofocus
        />
      </label>
      <label class="kv-dialog-field">
        Scope
        <KuiSelect
          :model-value="draft['kiraVersion.graph.scope']"
          :options="graphScopeOptions"
          @update:model-value="onGraphScopeChange"
        />
      </label>
    </section>

    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">Stash</h3>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="draft['kiraVersion.stash.showInGraph']" />
        Show stash entries as nodes in the commit graph
      </label>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="draft['kiraVersion.stash.includeUntracked']" />
        "Include untracked files" starts checked in the Stash dialog
      </label>
    </section>

    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">Branch review</h3>
      <label class="kv-dialog-field">
        Candidate base branches (one per line, tried in order)
        <textarea v-model="baseCandidatesText" rows="3"></textarea>
      </label>
    </section>

    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">GitHub</h3>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="draft['kiraVersion.github.enabled']" />
        Show pull request status for this repository
      </label>
    </section>

    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">Pull</h3>
      <label class="kv-dialog-field">
        Strategy
        <KuiSelect
          :model-value="draft['kiraVersion.pull.strategy']"
          :options="pullStrategyOptions"
          @update:model-value="onPullStrategyChange"
        />
      </label>
    </section>

    <section class="kv-repo-settings-section">
      <h3 class="kv-repo-settings-heading">Diagnostics</h3>
      <label class="kv-dialog-field">
        Log level
        <KuiSelect
          :model-value="draft['kiraVersion.log.level']"
          :options="logLevelOptions"
          @update:model-value="onLogLevelChange"
        />
      </label>
      <p v-if="logLevelInstanceWide" class="kv-dialog-note" data-testid="log-level-instance-wide-note">
        This applies to Kira Version's own diagnostic log for every repository, not just this one.
      </p>
    </section>

    <template #actions>
      <KuiButton variant="primary" @click="save">Save</KuiButton>
      <KuiButton @click="close">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-repo-settings-section {
  margin: var(--kv-space-3) 0;
}

.kv-repo-settings-section:first-of-type {
  margin-top: var(--kv-space-2);
}

.kv-repo-settings-heading {
  margin: 0 0 var(--kv-space-1) 0;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--kv-row-fg);
}

.kv-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-1);
  margin: var(--kv-space-2) 0;
}

.kv-dialog-field--inline {
  flex-direction: row;
  align-items: center;
}

.kv-dialog-field textarea {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-dialog-field input[type='number'] {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
  width: 8em;
}

.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}
</style>
