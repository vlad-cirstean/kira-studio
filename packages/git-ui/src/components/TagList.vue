<script setup lang="ts">
/**
 * `docs/plans/P6.md` W13: the picker's tags section, as its own component (judgment call 5's own
 * words: "a real component… not a sibling dropdown"). Renders exactly what `BranchPicker.vue`
 * hands it (already filtered/sorted/capped by `refListModel.ts`'s shared fold) plus its own
 * annotated/lightweight distinction (§7.9) and its own ref-scoped context menu (W14) — the same
 * menu shape `BranchPicker.vue`'s branch/remote rows use, built here because tag rows live in
 * this file's own template, not that one's.
 */
import type { InProgressOperation, RefRow } from '@kira/git-ipc';
import { cn } from '@theme/lib/utils';
import { computed } from 'vue';
import { rowVariants } from '../lib/rowVariants.ts';
import type { OpsState } from '../state/ops.ts';
import RefSectionHeader from './RefSectionHeader.vue';
import RowActionsButton from './RowActionsButton.vue';
import RowContextMenu from './RowContextMenu.vue';
import type { RefListSection } from './refListModel.ts';
import { buildRefMenu } from './rowMenuModel.ts';
import ShowMoreButton from './ShowMoreButton.vue';
import { useRowMenu } from './useRowMenu.ts';

const props = defineProps<{
  section: RefListSection;
  ops: OpsState;
  knownRemotes: readonly string[];
  inProgress: InProgressOperation | null;
  /** P77 §6.3: raises this tab's own cap by `REF_LIST_SECTION_CAP` for the current panel-open —
   *  `BranchPicker.vue` owns the `capSteps` state every tab's own button reaches through this. */
  showMore: () => void;
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
  return (row.peeledObjectId ?? row.objectId).slice(0, 7);
}

const { menu: refMenu, open: openRefMenu, openFromButton: openRefMenuFromButton } = useRowMenu<RefRow>();

const refMenuSections = computed(() => {
  const entry = refMenu.value;
  if (!entry) return [];
  return buildRefMenu({
    kind: 'tag',
    shortName: entry.row.shortName,
    isHead: false,
    knownRemotes: props.knownRemotes,
    inProgress: props.inProgress,
  });
});

async function onRefMenuSelect(id: string): Promise<void> {
  const entry = refMenu.value;
  refMenu.value = undefined;
  if (!entry) return;
  const { row } = entry;
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
  <section aria-label="Tags">
    <RefSectionHeader label="Tags" />
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
        <span class="text-kira-sm text-muted-foreground">{{ row.annotation ? "annotated" : "lightweight" }}</span>
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
        @click="openRefMenuFromButton(row, $event)"
        @contextmenu="openRefMenu(row, $event)"
      />
    </div>
    <ShowMoreButton :hidden-count="section.hiddenCount" @click="showMore" />
    <div v-if="section.visible.length === 0" class="text-kira-sm text-subtle py-1 px-1.5">No tags</div>

    <RowContextMenu
      v-if="refMenu"
      :sections="refMenuSections"
      :x="refMenu.x"
      :y="refMenu.y"
      :label="`${refMenu.row.shortName} actions`"
      @select="onRefMenuSelect"
      @close="refMenu = undefined"
    />
  </section>
</template>

