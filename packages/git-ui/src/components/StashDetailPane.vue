<script setup lang="ts">
/**
 * `docs/plans/P9.md` W14 (OQ4): "selecting a stash node or list row loads `stash.show` into the
 * existing `FileTree.vue`". Mirrors `DetailPane.vue`'s own composition but keyed off `StashState`
 * rather than `DetailState` — a stash entry has none of `CommitDetail`'s richer shape (body/
 * trailers/signature/multiple parents), so `CommitMeta.vue` is not reused here; this file's own
 * small header says the one thing worth saying about a stash (message, base commit, date, `-u`
 * marker) instead.
 *
 * G21 D12 (item 12): no longer also composes `DiffView.vue` — opens the host's native diff
 * editor now, exactly like `DetailPane.vue` since the same phase. The one real technical wrinkle
 * `StashState` used to handle itself (F12): a stash's `-u` untracked files live only in its third
 * parent (`entry.untrackedSha`), which has no `baseSha` of its own — `editor.openDiff`'s own
 * `fallbackSha` param (D12) carries that through to the host handler now, which retries the whole
 * composition against it when `path` is not among the primary sha's changed files.
 */
import type { CommitStore } from '@kira/git-core';
import { Empty, EmptyDescription } from '@theme/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import type { DetailActions } from '../state/detailActions.ts';
import type { StashState } from '../state/stash.ts';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';
import FileTree from './FileTree.vue';
import { openFileAnnounced } from './openFileAnnounced.ts';

const props = defineProps<{
  stash: StashState;
  store: CommitStore;
  actions: DetailActions;
}>();

const entry = computed(() => props.stash.selected.value);
const files = computed(() => props.stash.changes.value ?? []);
/** Single-element — `FileTree.vue`'s own merge-parent picker only renders past `length > 1`, so
 *  this never shows one (a stash entry is never a merge from the UI's point of view: §7.6 truncates
 *  its parent list to `[baseSha]` in the graph, and the detail pane matches that). */
const parents = computed(() => (entry.value ? [entry.value.baseSha] : []));

/** G21 D12/D13: mirrors `DetailPane.vue`'s own `onOpenFile` — the one difference is `fallbackSha`,
 *  carrying `entry.untrackedSha` through so the host can retry an untracked file's composition
 *  against the stash's own third parent instead of throwing. */
function onOpenFile(index: number, pinned: boolean): void {
  const file = files.value[index];
  const current = entry.value;
  if (!file || !current) return;
  openFileAnnounced(props.actions, file.path, () =>
    props.actions.openInEditor({
      sha: current.sha,
      path: file.path,
      originalPath: file.originalPath,
      parentIndex: 0,
      pinned,
      ...(current.untrackedSha !== undefined ? { fallbackSha: current.untrackedSha } : {}),
    }),
  );
}
</script>

<template>
  <div class="flex flex-col min-h-0 h-full">
    <p v-if="stash.error.value" class="m-0 p-3 text-error">
      Couldn't load this stash — {{ stash.error.value }}
    </p>

    <template v-if="entry">
      <div class="py-2 px-3 border-b border-border">
        <p class="m-0 mb-0.5 font-semibold break-words">{{ entry.message }}</p>
        <p class="m-0 text-graph-sm text-muted-foreground">
          <Tooltip>
            <TooltipTrigger as-child>
              <span>{{ formatRelativeDate(entry.timestamp) }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ formatAbsoluteDate(entry.timestamp) }}</TooltipContent>
          </Tooltip>
          <span> · based on <code class="font-data">{{ entry.baseSha.slice(0, 7) }}</code></span>
          <span v-if="entry.baseSubject"> {{ entry.baseSubject }}</span>
          <span v-if="entry.includedUntracked" class="ml-1 font-data text-subtle">-u</span>
        </p>
      </div>
      <FileTree
        class="flex-auto min-h-0 border-y border-border"
        :files="files"
        :selected-file="stash.selectedFile.value"
        :list-mode="stash.listMode.value"
        :filter="stash.filter.value"
        :parents="parents"
        :parent-index="0"
        :store="store"
        :actions="actions"
        @select-file="stash.selectFile($event)"
        @open-file="onOpenFile"
        @update:list-mode="stash.setListMode($event)"
        @update:filter="stash.setFilter($event)"
      />
    </template>

    <Empty v-else-if="!stash.error.value" class="p-6"><EmptyDescription>Loading…</EmptyDescription></Empty>
  </div>
</template>
