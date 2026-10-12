<script setup lang="ts">
import KeyValueList from '@theme/components/KeyValueList.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/behaviour/virtualRows';
import { useRowHeight } from '@workbench/lib/rowHeight';
import { computed, useTemplateRef } from 'vue';
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

// A branch can touch thousands of files or commits: each list scrolls in its own box and renders only the window.
const { single: rowHeight } = useRowHeight();
const filesEl = useTemplateRef<HTMLElement>('filesEl');
const commitsEl = useTemplateRef<HTMLElement>('commitsEl');
const {
  virtualItems: fileItems,
  totalSize: filesSize,
  onScroll: onFilesScroll,
} = useVirtualRows({
  count: () => props.branch.files.length,
  rowHeight: () => rowHeight.value,
  scrollElement: filesEl,
});
const {
  virtualItems: commitItems,
  totalSize: commitsSize,
  onScroll: onCommitsScroll,
} = useVirtualRows({
  count: () => props.branch.commits.length,
  rowHeight: () => rowHeight.value,
  scrollElement: commitsEl,
});

const dirtyClass = (d: DirtyEntry): string =>
  d.code === 'M' ? 'text-tone-amber' : 'text-tone-green';
const commitTitle = (c: Commit): string => `${c.sha} ${c.message}`;
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 pt-3 text-kira-md"
    data-testid="ade-changes-tab"
  >
    <KeyValueList class="items-baseline">
      <dt>{{ t('space.common.base.label') }}</dt>
      <dd class="font-data text-kira-sm">{{ base }} · ↑{{ branch.ahead }} ↓{{ branch.behind }}</dd>
      <dt>{{ t('common.worktree.label') }}</dt>
      <dd
        class="font-data text-kira-sm"
        :class="branch.dirty.length ? 'text-tone-amber' : undefined"
        data-testid="ade-changes-worktree"
      >
        {{ worktree }}
      </dd>
      <template v-if="conflicts">
        <dt>{{ t('space.ade.changes.conflicts.label') }}</dt>
        <dd class="font-data text-kira-sm text-tone-red" data-testid="ade-changes-conflict">
          {{ conflicts }}
        </dd>
      </template>
      <template v-if="shared">
        <dt>{{ t('space.ade.changes.shares.label') }}</dt>
        <dd class="font-data text-kira-sm text-tone-amber" data-testid="ade-changes-shared">
          {{ shared }}
        </dd>
      </template>
    </KeyValueList>

    <div v-if="branch.dirty.length" class="flex flex-col gap-0.5">
      <SectionHeading :label="t('space.ade.changes.uncommitted.label')" />
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
      <SectionHeading :label="t('common.module.commits.label')" />
      <div
        ref="commitsEl"
        class="max-h-64 overflow-auto"
        data-testid="ade-changes-commits"
        @scroll.passive="onCommitsScroll"
      >
        <div class="relative w-full" :style="{ height: `${commitsSize}px` }">
          <div
            v-for="item in commitItems"
            :key="branch.commits[item.index]?.sha ?? item.key"
            :class="cn(VIRTUAL_ROW_CLASS, 'flex items-baseline gap-2')"
            :style="{ height: `${rowHeight}px`, transform: `translateY(${item.start}px)` }"
            data-testid="ade-changes-commit-row"
          >
            <span class="font-data text-kira-sm text-tone-amber-solid">{{
              branch.commits[item.index]?.sha
            }}</span>
            <AdeTip :text="commitTitle(branch.commits[item.index] as Commit)"
              ><span class="truncate">{{ branch.commits[item.index]?.message }}</span></AdeTip
            >
          </div>
        </div>
      </div>
      <div
        v-if="branch.commitCount > branch.commits.length"
        class="text-kira-sm text-muted-foreground"
      >
        {{ t('common.more.label', { count: branch.commitCount - branch.commits.length }) }}
      </div>
    </div>

    <div class="flex flex-col gap-0.5">
      <SectionHeading :label="t('common.module.files.label')" />
      <div
        ref="filesEl"
        class="max-h-64 overflow-auto"
        data-testid="ade-changes-files"
        @scroll.passive="onFilesScroll"
      >
        <div class="relative w-full" :style="{ height: `${filesSize}px` }">
          <div
            v-for="item in fileItems"
            :key="branch.files[item.index]?.path ?? item.key"
            :class="
              cn(
                VIRTUAL_ROW_CLASS,
                'truncate rounded-kira-xs px-1.5 py-0.5 font-data text-kira-sm',
                branch.conflictsIfRebased.includes(branch.files[item.index]?.path ?? '') ? TONE_TAG_CLASS.red : 'text-fg',
              )
            "
            :style="{ height: `${rowHeight}px`, transform: `translateY(${item.start}px)` }"
            data-testid="ade-changes-file-row"
          >
            {{ branch.files[item.index]?.path }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
