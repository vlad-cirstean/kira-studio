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
import { KuiButton, kuiRowVariants } from '@kira/kira-ui';
import { computed } from 'vue';
import type { OpsState } from '../state/ops.ts';
import RowContextMenu from './RowContextMenu.vue';
import { REF_LIST_SECTION_CAP, type RefListSection } from './refListModel.ts';
import { buildReadOnlyRefMenu, buildRefMenu } from './rowMenuModel.ts';
import { useRowMenu } from './useRowMenu.ts';

const props = defineProps<{
  section: RefListSection;
  ops: OpsState;
  knownRemotes: readonly string[];
  inProgress: InProgressOperation | null;
  /** C10 §4.2/§4.3 (S6): `false` under the native read-only graph — the row menu falls back to
   *  `buildReadOnlyRefMenu` (empty) instead of `buildRefMenu`. */
  writeCapability: boolean;
  /** P77 §6.3: raises this tab's own cap by `REF_LIST_SECTION_CAP` for the current panel-open —
   *  `BranchPicker.vue` owns the `capSteps` state every tab's own button reaches through this. */
  showMore: () => void;
  /** P77 §7.3: the roving-tabindex list's own "current" row id (`BranchPicker.vue`'s own
   *  `activeRowId`) — every row binds `tabindex`/`data-row-id` off it; the actual key handling
   *  lives in `BranchPicker.vue`, which owns the body every tab's rows render into. */
  focusedRowId?: string;
}>();

const emit = defineEmits<(e: 'checked-out') => void>();

// C12-6: the row's own main click handler — same gap BranchPicker.vue's own branch/remote rows
// had (see that file's own comment on `checkoutBranch`): unlike the ref-scoped context menu
// (gated below via `buildReadOnlyRefMenu`), nothing stopped this from running under
// `writeCapability: false`, issuing a `preflight.checkout` the native read-only stream refuses
// with an unhandled promise rejection.
async function checkout(row: RefRow): Promise<void> {
  if (!props.writeCapability) return;
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
  return props.writeCapability
    ? buildRefMenu({
        kind: 'tag',
        shortName: entry.row.shortName,
        isHead: false,
        knownRemotes: props.knownRemotes,
        inProgress: props.inProgress,
      })
    : buildReadOnlyRefMenu();
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
  // C12-6: buildReadOnlyRefMenu's own "Review branch changes" item (rowMenuModel.ts) — reachable
  // from here via the `!props.writeCapability` branch above despite that function's own doc
  // comment claiming "a tag entry never reaches this function" (fixed alongside this). Mirrors
  // BranchPicker.vue's identical case for its own branch/remote rows.
  if (id === 'reviewBranch') {
    await props.ops.openReview(row.shortName);
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
  <section class="kv-branch-section" aria-label="Tags">
    <div class="kv-branch-section-title">Tags</div>
    <div
      v-for="row in section.visible"
      :key="row.refname"
      class="kv-branch-row"
      :data-row-id="`tag:${row.refname}`"
      :tabindex="focusedRowId === `tag:${row.refname}` ? 0 : -1"
    >
      <KuiButton :class="[kuiRowVariants(), 'kv-branch-row-main']" @click="checkout(row)">
        <span
          class="codicon codicon-tag"
          :class="{ 'kv-tag-lightweight': !row.annotation }"
          aria-hidden="true"
        ></span>
        <span class="kv-branch-row-name">{{ row.shortName }}</span>
        <span class="kv-tag-kind">{{ row.annotation ? "annotated" : "lightweight" }}</span>
        <span v-if="row.annotation" class="kv-tag-subject" v-kui-tooltip="row.annotation.subject">
          {{ row.annotation.subject }}
        </span>
        <span class="kv-tag-target">{{ targetCommit(row) }}</span>
      </KuiButton>
      <KuiButton
        variant="icon"
        v-kui-tooltip="'More actions'"
        aria-label="More actions"
        @click="openRefMenuFromButton(row, $event)"
        @contextmenu="openRefMenu(row, $event)"
      >
        <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
      </KuiButton>
    </div>
    <KuiButton v-if="section.hiddenCount > 0" class="kv-branch-more-button" @click="showMore">
      Show {{ Math.min(REF_LIST_SECTION_CAP, section.hiddenCount) }} more ({{ section.hiddenCount }} remaining)
    </KuiButton>
    <div v-if="section.visible.length === 0" class="kv-branch-empty">No tags</div>

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

<style>
.kv-tag-kind {
  font-size: 0.75em;
  color: var(--kv-description-fg);
}

.kv-tag-lightweight {
  opacity: 0.6;
}

.kv-tag-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85em;
  color: var(--kv-description-fg);
}

.kv-tag-target {
  font-family: var(--kv-mono-font-family);
  font-size: 0.85em;
  color: var(--kv-description-fg);
}
</style>
