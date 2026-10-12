<script setup lang="ts">
/**
 * `docs/plans/P6.md` W13: the picker's tags section, as its own component (judgment call 5's own
 * words: "a real component… not a sibling dropdown"). Renders exactly what `BranchPicker.vue`
 * hands it (already filtered/sorted/capped by `refListModel.ts`'s shared fold) plus its own
 * annotated/lightweight distinction (§7.9) and its own ref-scoped context menu (W14) — the same
 * menu shape `BranchPicker.vue`'s branch/remote rows use, built here because tag rows live in
 * this file's own template, not that one's.
 */
import { shortSha } from '@kira/git-core';
import type { InProgressOperation, RefRow } from '@kira/git-ipc';
import { rowVariants } from '@theme/components/rowVariants';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import type { OpsState } from '../state/ops.ts';
import RowActionsButton from './RowActionsButton.vue';
import type { RefListSection } from './refListModel.ts';
import { buildRefMenu } from './rowMenuModel.ts';
import { useSectionMenu } from './useSectionMenu.ts';

const props = defineProps<{
  section: RefListSection;
  ops: OpsState;
  knownRemotes: readonly string[];
  inProgress: InProgressOperation | null;
  /** P77 §7.3: the roving-tabindex list's own "current" row id (`BranchPicker.vue`'s own
   *  `activeRowId`) — every row binds `tabindex`/`data-row-id` off it; the actual key handling
   *  lives in `BranchPicker.vue`, which owns the body every tab's rows render into. */
  focusedRowId?: string;
}>();

const emit = defineEmits<(e: 'checked-out') => void>();

async function checkout(row: RefRow): Promise<void> {
  emit('checked-out');
  await props.ops.runCheckout(row.shortName, 'switch');
}

/** §7.9: the commit a tag ultimately resolves to — the peeled commit for an annotated tag (whose
 *  own `objectId` is the TAG OBJECT's sha, not a commit's), the ref's own `objectId` for a
 *  lightweight one. Mirrors `core`'s `tagTargetCommit`, adapted to the wire's `RefRow` rather than
 *  a full `RefRecord` (this file has no need for `objectType`). */
function targetCommit(row: RefRow): string {
  return shortSha(row.peeledObjectId ?? row.objectId);
}

const rowMenu = useSectionMenu();

function menuFor(row: RefRow) {
  return buildRefMenu({
    kind: 'tag',
    shortName: row.shortName,
    isHead: false,
    knownRemotes: props.knownRemotes,
    inProgress: props.inProgress,
  });
}

async function onRefMenuSelect(row: RefRow, id: string): Promise<void> {
  if (id === 'checkoutRef') {
    await checkout(row);
    return;
  }
  if (id === 'deleteRef') {
    await props.ops.tagDelete(row.shortName);
    return;
  }
  if (id.startsWith('pushRef:')) {
    await props.ops.tagPush(id.slice('pushRef:'.length), [row.shortName]);
    return;
  }
  if (id.startsWith('deleteRemoteRef:')) {
    await props.ops.tagDeleteRemote(id.slice('deleteRemoteRef:'.length), row.shortName);
  }
}
</script>

<template>
  <section :aria-label="t('git.tag.list.label')">
    <SectionHeading :label="t('git.tag.list.label')" />
    <div data-testid="branch-row"
      v-for="row in section.visible"
      :key="row.refname"
      class="flex items-center gap-0.5 px-1"
      :data-row-id="`tag:${row.refname}`"
      :tabindex="focusedRowId === `tag:${row.refname}` ? 0 : -1"
    >
      <button data-testid="branch-row-main"
        type="button"
        :class="cn(rowVariants(), 'flex-1 min-w-0 text-left')"
        @click="checkout(row)"
      >
        <span
          class="codicon codicon-tag"
          :class="{ 'text-subtle': !row.annotation }"
          aria-hidden="true"
        ></span>
        <span class="truncate">{{ row.shortName }}</span>
        <span class="text-kira-sm text-muted-foreground">{{ row.annotation ? t('git.tag.annotated.status') : t('git.tag.lightweight.status') }}</span>
        <span
          v-if="row.annotation"
          class="flex-1 min-w-0 truncate text-kira-sm text-muted-foreground"
          :data-kira-tip="row.annotation.subject"
        >
          {{ row.annotation.subject }}
        </span>
        <span class="font-data text-kira-sm text-muted-foreground">{{ targetCommit(row) }}</span>
      </button>
      <RowActionsButton
        @click="rowMenu.openFromButton($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
        @contextmenu="rowMenu.openAt($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
      />
    </div>
    <div v-if="section.visible.length === 0" class="text-kira-sm text-subtle py-1 px-1.5">{{ t('git.tag.list.empty') }}</div>

  </section>
</template>

