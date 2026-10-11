<script setup lang="ts">
import { t } from '@theme/i18n';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { TONE_TAG_CLASS } from '../tones';
import type { Branch, Commit, DirtyEntry } from '../wire';

// Branch Changes tab: base, worktree, rebase conflicts, shared files, uncommitted, commits, files.
const props = defineProps<{
  branch: Branch;
  /** Base ref name shown next to the ahead/behind counts. */
  base: string;
  /** `<earlier branch> · <file>` when an earlier-merging branch shares a file, else `''`. */
  shared: string;
}>();

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

const worktree = computed(() => {
  const b = props.branch;
  if (b.name === '') return t('space.ade.changes.createdOnStart.status');
  const where = b.worktree || t('space.ade.changes.noWorktree.status');
  return b.dirty.length
    ? t('space.ade.changes.worktreeDirty.label', { where, count: b.dirty.length })
    : where;
});
const conflicts = computed(() => props.branch.conflictsIfRebased.map(basename).join(', '));

const dirtyClass = (d: DirtyEntry): string => (d.code === 'M' ? 'text-tone-amber' : 'text-tone-green');
const commitTitle = (c: Commit): string => `${c.sha} ${c.message}`;
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 pt-2.5 text-kira-md"
    data-testid="ade-changes-tab"
  >
    <div class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5">
      <span class="text-muted-foreground">{{ t('space.common.base.label') }}</span>
      <span class="font-data text-kira-sm">{{ base }} · ↑{{ branch.ahead }} ↓{{ branch.behind }}</span>
      <span class="text-muted-foreground">{{ t('space.common.worktree.label') }}</span>
      <span
        class="font-data text-kira-sm"
        :class="branch.dirty.length ? 'text-tone-amber' : undefined"
        data-testid="ade-changes-worktree"
        >{{ worktree }}</span
      >
      <template v-if="conflicts">
        <span class="text-muted-foreground">{{ t('space.ade.changes.conflicts.label') }}</span>
        <span class="font-data text-kira-sm text-tone-red" data-testid="ade-changes-conflict">{{
          conflicts
        }}</span>
      </template>
      <template v-if="shared">
        <span class="text-muted-foreground">{{ t('space.ade.changes.shares.label') }}</span>
        <span class="font-data text-kira-sm text-tone-amber" data-testid="ade-changes-shared">{{
          shared
        }}</span>
      </template>
    </div>

    <div v-if="branch.dirty.length" class="flex flex-col gap-0.5">
      <div class="text-muted-foreground">{{ t('space.ade.changes.uncommitted.label') }}</div>
      <div
        v-for="d in branch.dirty"
        :key="d.path"
        class="flex gap-2 font-data text-kira-sm"
        data-testid="ade-changes-dirty-row"
      >
        <span class="w-4" :class="dirtyClass(d)">{{ d.code }}</span>
        <span class="text-fg">{{ d.path }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-0.5">
      <div class="text-muted-foreground">{{ t('common.module.commits.label') }}</div>
      <div
        v-for="c in branch.commits"
        :key="c.sha"
        class="flex items-baseline gap-2"
        data-testid="ade-changes-commit-row"
      >
        <span class="font-data text-kira-sm text-tone-amber-solid">{{ c.sha }}</span>
        <AdeTip :text="commitTitle(c)"><span class="truncate">{{ c.message }}</span></AdeTip>
      </div>
      <div v-if="branch.commitCount > branch.commits.length" class="text-kira-sm text-muted-foreground">
        {{ t('space.ade.changes.moreCommits.label', { count: branch.commitCount - branch.commits.length }) }}
      </div>
    </div>

    <div class="flex flex-col gap-0.5">
      <div class="text-muted-foreground">{{ t('common.module.files.label') }}</div>
      <div
        v-for="f in branch.files"
        :key="f.path"
        class="truncate rounded-kira-xs px-1.5 py-0.5 font-data text-kira-sm"
        :class="branch.conflictsIfRebased.includes(f.path) ? TONE_TAG_CLASS.red : 'text-fg'"
        data-testid="ade-changes-file-row"
      >
        {{ f.path }}
      </div>
    </div>
  </div>
</template>
