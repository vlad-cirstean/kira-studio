<script setup lang="ts">
import { computed } from 'vue';
import { TONE } from './tones';
import type { QueueItem, QueuePanel, QueuePanelConflict } from './useQueue';

// P129 Part 6 §0.17: the Changes tab (mockup 373-406) — straight off `panel.changes`. Rows with
// nothing to show are omitted, as in the mockup (Conflicts/Shares); Commits/Files render their own
// label even with an empty list, matching the mockup's own unconditional blocks.
const props = defineProps<{
  changes: QueuePanel['changes'];
  /** Resolves `conflicts[].with`/`shared.with` (item ids, §2.3) to a branch name for display —
   *  `panel.changes` itself stays structured data, not pre-formatted text (unlike the mockup's own
   *  `sel.conflict`/`sel.shared` strings), so only the top conflict needs a name lookup here. */
  itemsById: ReadonlyMap<string, QueueItem>;
}>();

function branchNameOf(id: string): string {
  return props.itemsById.get(id)?.branch || id;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

const worktreeColor = computed(() => (props.changes.dirtyCount ? TONE.amber[1] : 'var(--kira-fg)'));
const rippleColor = computed(() => (props.changes.rippleTone === 'amber' ? TONE.amber[1] : 'var(--kira-fg)'));

const conflictText = computed(() => {
  const c0: QueuePanelConflict | undefined = props.changes.conflicts[0];
  if (!c0) return '';
  return `${branchNameOf(c0.with)} · ${c0.files.map(basename).join(', ')}`;
});

const sharedText = computed(() => {
  const shared = props.changes.shared;
  if (!shared) return '';
  return `${branchNameOf(shared.with)} · ${shared.file}`;
});

function fileDelta(f: QueuePanel['changes']['files'][number]): string {
  if (f.binary) return 'binary';
  const parts: string[] = [];
  if (f.added !== null) parts.push(`+${f.added}`);
  if (f.deleted !== null) parts.push(`−${f.deleted}`);
  return parts.join(' ');
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3.5 pb-3.5 pt-2.5 text-kira-sm"
    data-testid="ade-changes-tab"
  >
    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5">
      <span class="text-muted-foreground">Base</span>
      <span class="font-data text-kira-sm"
        >{{ changes.base }} · ↑{{ changes.ahead }} ↓{{ changes.behind }}</span
      >
      <span class="text-muted-foreground">Worktree</span>
      <span class="font-data text-kira-sm" :style="{ color: worktreeColor }">{{ changes.worktree }}</span>
      <span class="text-muted-foreground">On merge</span>
      <span :style="{ color: rippleColor }">{{ changes.rippleText }}</span>
      <template v-if="changes.conflicts.length">
        <span class="text-muted-foreground">Conflicts</span>
        <span class="font-data text-kira-sm text-[#f28b7d]" data-testid="ade-changes-conflict">{{
          conflictText
        }}</span>
      </template>
      <template v-if="changes.shared">
        <span class="text-muted-foreground">Shares</span>
        <span class="font-data text-kira-sm text-[#f0b85c]" data-testid="ade-changes-shared">{{
          sharedText
        }}</span>
      </template>
    </div>

    <div v-if="changes.dirty.length" class="flex flex-col gap-0.5">
      <div class="text-muted-foreground">Uncommitted</div>
      <div
        v-for="(d, i) in changes.dirty"
        :key="i"
        class="flex gap-2 font-data text-kira-sm"
        data-testid="ade-changes-dirty-row"
      >
        <span class="w-4" :style="{ color: d.code === 'M' ? TONE.amber[1] : TONE.green[1] }">{{ d.code }}</span>
        <span class="text-fg">{{ d.path }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-[3px]">
      <div class="text-muted-foreground">Commits</div>
      <div
        v-for="c in changes.commits"
        :key="c.sha"
        class="flex items-baseline gap-2"
        data-testid="ade-changes-commit-row"
      >
        <span class="font-data text-kira-sm text-muted-foreground">{{ c.sha }}</span>
        <span class="truncate">{{ c.message }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-0.5">
      <div class="text-muted-foreground">Files</div>
      <div
        v-for="f in changes.files"
        :key="f.path"
        class="flex justify-between gap-2 rounded font-data text-kira-sm"
        :class="f.conflict ? 'bg-[rgba(239,107,91,0.08)] text-[#f28b7d]' : 'text-fg'"
        style="padding: 2px 6px"
        data-testid="ade-changes-file-row"
      >
        <span class="truncate">{{ f.path }}</span>
        <span class="shrink-0 text-muted-foreground">{{ fileDelta(f) }}</span>
      </div>
    </div>
  </div>
</template>
