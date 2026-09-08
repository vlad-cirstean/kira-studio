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
 */
import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsPatch, RepoSettingsSnapshot } from '@kira/git-ipc';
import { computed, reactive, ref, watch } from 'vue';
import type { RepoSettingsState } from '../../state/repoSettings.ts';
import { useModalFocus } from './modalFocus.ts';

const props = defineProps<{
  open: boolean;
  repoSettingsState: RepoSettingsState;
}>();

const emit = defineEmits<(e: 'close') => void>();

const rootEl = ref<HTMLDivElement | null>(null);
const active = computed(() => props.open);
const { onKeydown } = useModalFocus(active, rootEl);

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
  if (Object.keys(patch).length > 0) {
    await props.repoSettingsState.set(patch);
  }
  close();
}
</script>

<template>
  <div v-if="active" class="kv-modal-backdrop">
    <div
      ref="rootEl"
      class="kv-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-repo-settings-dialog-title"
      @keydown="onKeydown"
      @keydown.escape="close"
    >
      <h2 id="kv-repo-settings-dialog-title" class="kv-modal-title">Repository settings</h2>

      <section class="kv-repo-settings-section">
        <h3 class="kv-repo-settings-heading">Graph</h3>
        <label class="kv-tag-field">
          Load more page size
          <input
            type="number"
            v-model.number="draft['kiraVersion.graph.pageSize']"
            :min="SETTINGS['kiraVersion.graph.pageSize'].minimum"
            :max="SETTINGS['kiraVersion.graph.pageSize'].maximum"
            autofocus
          />
        </label>
        <label class="kv-tag-field">
          Scope
          <select v-model="draft['kiraVersion.graph.scope']">
            <option value="all">All refs</option>
            <option value="head">Current HEAD's ancestry only</option>
          </select>
        </label>
      </section>

      <section class="kv-repo-settings-section">
        <h3 class="kv-repo-settings-heading">Stash</h3>
        <label class="kv-tag-field kv-tag-field--inline">
          <input type="checkbox" v-model="draft['kiraVersion.stash.showInGraph']" />
          Show stash entries as nodes in the commit graph
        </label>
        <label class="kv-tag-field kv-tag-field--inline">
          <input type="checkbox" v-model="draft['kiraVersion.stash.includeUntracked']" />
          "Include untracked files" starts checked in the Stash dialog
        </label>
      </section>

      <section class="kv-repo-settings-section">
        <h3 class="kv-repo-settings-heading">Branch review</h3>
        <label class="kv-tag-field">
          Candidate base branches (one per line, tried in order)
          <textarea v-model="baseCandidatesText" rows="3"></textarea>
        </label>
      </section>

      <section class="kv-repo-settings-section">
        <h3 class="kv-repo-settings-heading">Pull</h3>
        <label class="kv-tag-field">
          Strategy
          <select v-model="draft['kiraVersion.pull.strategy']">
            <option value="auto">Auto (follow git configuration)</option>
            <option value="ff-only">Fast-forward only</option>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </select>
        </label>
      </section>

      <section class="kv-repo-settings-section">
        <h3 class="kv-repo-settings-heading">Diagnostics</h3>
        <label class="kv-tag-field">
          Log level
          <select v-model="draft['kiraVersion.log.level']">
            <option value="off">Off</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <p v-if="logLevelInstanceWide" class="kv-modal-note" data-testid="log-level-instance-wide-note">
          This applies to Kira Version's own diagnostic log for every repository, not just this one.
        </p>
      </section>

      <div class="kv-modal-actions">
        <button type="button" class="kv-modal-button kv-modal-button--primary" @click="save">
          Save
        </button>
        <button type="button" class="kv-modal-button" @click="close">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style>
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

/* `.kv-tag-field textarea`/`input[type="text"]` are already styled, unscoped, by
   `TagDialog.vue` (App.vue always mounts it alongside this file) — only `select` and
   `input[type="number"]` are genuinely new here. */
.kv-tag-field select {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-tag-field input[type="number"] {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
  width: 8em;
}
</style>
