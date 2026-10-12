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
import CodiconIcon from '@theme/CodiconIcon.vue';
import InlineState from '@theme/components/InlineState.vue';
import { rowMeta, rowVariants } from '@theme/components/rowVariants';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import Identifier from '@workbench/components/Identifier.vue';
import { inject } from 'vue';
import { PICKER_FOCUS_ROW } from '../lib/pickerNav.ts';
import type { RefListSection } from '../lib/refListModel.ts';
import { buildRefMenu } from '../lib/rowMenuModel.ts';
import { useSectionMenu } from '../lib/useSectionMenu.ts';
import type { OpsState } from '../state/ops.ts';
import RowActionsButton from './RowActionsButton.vue';

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

const emit = defineEmits<(e: 'checkedOut') => void>();

async function checkout(row: RefRow): Promise<void> {
  emit('checkedOut');
  await props.ops.runCheckout(row.shortName, 'switch');
}

/** §7.9: the commit a tag ultimately resolves to — the peeled commit for an annotated tag (whose
 *  own `objectId` is the TAG OBJECT's sha, not a commit's), the ref's own `objectId` for a
 *  lightweight one. Mirrors `core`'s `tagTargetCommit`, adapted to the wire's `RefRow` rather than
 *  a full `RefRecord` (this file has no need for `objectType`). */
function targetCommit(row: RefRow): string {
  return row.peeledObjectId ?? row.objectId;
}

const rowMenu = useSectionMenu();
const focusRow = inject(PICKER_FOCUS_ROW, () => undefined);

function onContextMenu(event: MouseEvent, row: RefRow): void {
  focusRow(`tag:${row.refname}`);
  rowMenu.openAt(event, menuFor(row), (id) => onRefMenuSelect(row, id));
}

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
    <div
      data-testid="branch-row"
      v-for="row in section.visible"
      :key="row.refname"
      class="flex items-center gap-0.5 px-1"
      :data-row-id="`tag:${row.refname}`"
      :tabindex="focusedRowId === `tag:${row.refname}` ? 0 : -1"
    >
      <button
        data-testid="branch-row-main"
        type="button"
        :class="cn(rowVariants(), 'flex-1 min-w-0 text-left')"
        @click="checkout(row)"
      >
        <CodiconIcon name="tag" :size="13" :class="row.annotation ? '' : 'text-muted-foreground'" />
        <span class="truncate">{{ row.shortName }}</span>
        <span :class="rowMeta">{{
          row.annotation ? t('git.tag.annotated.status') : t('git.tag.lightweight.status')
        }}</span>
        <span
          v-if="row.annotation"
          :class="cn('flex-1 min-w-0 truncate', rowMeta)"
          :data-kira-tip="row.annotation.subject"
        >
          {{ row.annotation.subject }}
        </span>
        <Identifier :value="targetCommit(row)" :short="shortSha" :class="rowMeta" />
      </button>
      <RowActionsButton
        @click="rowMenu.openFromButton($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
        @contextmenu="onContextMenu($event, row)"
      />
    </div>
    <InlineState v-if="section.visible.length === 0" kind="empty">{{
      t('git.tag.list.empty')
    }}</InlineState>
  </section>
</template>
