<script setup lang="ts">
/**
 * G28 D13: the global stash bucket's own section — `StashList.vue`'s structure, with
 * `stash@{N}` replaced by the origin-branch chip and the label (`globalRowModel`), and a header
 * "Save to global stash…" button that opens `StashDialog.vue`'s fourth mode (bubbled to
 * `App.vue`, mirroring `branchFromStash`'s own "this component owns no dialog of its own" shape).
 * Row menu: Apply here, Create branch from this…, Show changes, Remove from global stash — no
 * Pop, no Drop (`buildGlobalStashMenu`, D12: both are position-addressed by necessity and a
 * global entry has no stack position at all).
 *
 * P77 §11: renders the already filtered/ordered/capped `section` prop `pickerModel.ts` hands it —
 * the same `TagList.vue`/`StashList.vue` contract, this component owns no fold of its own.
 *
 * I2-21: the row list itself moved to `StashRows.vue`, shared with `StashList.vue` — see that
 * file's own doc comment.
 */
import type { InProgressOperation, StashEntry } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import type { OpsState } from '../state/ops.ts';
import type { StashState } from '../state/stash.ts';
import type { PickerList } from './pickerModel.ts';
import { buildGlobalStashMenu } from './rowMenuModel.ts';
import StashRows, { type StashRowModel } from './StashRows.vue';
import { globalRowModel } from './stashListModel.ts';

const props = defineProps<{
  section: PickerList<StashEntry>;
  stash: StashState;
  ops: OpsState;
  inProgress: InProgressOperation | null;
  currentBranch?: string | null;
  /** C10 §4.2/§4.3 (S6): `false` under the native read-only graph — hides the header's "Save to
   *  global stash…" button (`globalStashSave`, a write) and falls the row menu back to
   *  `buildReadOnlyStashMenu` (Show changes only) instead of `buildGlobalStashMenu`. */
  writeCapability: boolean;
  /** P77 §6.3: raises this tab's own cap — see `TagList.vue`'s own doc comment on this prop. */
  showMore: () => void;
  /** P77 §7.3 — see `TagList.vue`'s own doc comment on this prop. */
  focusedRowId?: string;
}>();

const emit = defineEmits<{
  (e: 'branchFromStash', entry: StashEntry): void;
  (e: 'saveGlobalStash'): void;
  /** P77 §14 (N9) — see `StashList.vue`'s own doc comment on this event. This also makes a
   *  global-stash entry reachable at all: it can never be a graph row, so before this fix "Show
   *  changes" needed an unrelated commit selected first for `hasSelection` to be true. */
  (e: 'selected'): void;
}>();

function globalStashRowModel(entry: StashEntry): StashRowModel {
  const model = globalRowModel(entry);
  return {
    id: `global:${entry.sha}`,
    origin: model.origin,
    originTooltip: model.origin === undefined ? undefined : `Saved from ${model.origin}`,
    auto: model.auto,
    message: model.label,
    messageTooltip: entry.message,
  };
}

function menuFor(entry: StashEntry) {
  return buildGlobalStashMenu(props.inProgress, entry, props.currentBranch ?? null);
}

function menuLabel(): string {
  return 'Global stash entry actions';
}

async function onMenuSelect(id: string, entry: StashEntry): Promise<void> {
  switch (id) {
    case 'stashApply':
      await props.ops.runStashApply(entry);
      return;
    case 'stashBranch':
      emit('branchFromStash', entry);
      return;
    case 'stashShow':
      props.stash.select(entry.sha);
      emit('selected');
      return;
    case 'globalStashRemove':
      await props.ops.runGlobalStashRemove(entry);
      return;
    default:
      return;
  }
}
</script>

<template>
  <section aria-label="Global stash">
    <div class="kv:flex kv:items-center kv:justify-between kv:h-control-sm kv:px-2 kv:text-xs kv:font-semibold kv:text-muted kv:uppercase kv:tracking-wider">
      <span>Global stash</span>
      <KuiButton
        v-if="writeCapability"
        variant="icon"
        icon="codicon-add"
        v-kui-tooltip="'Save to global stash…'"
        aria-label="Save to global stash…"
        @click="emit('saveGlobalStash')"
      />
    </div>
    <StashRows
      :section="section"
      :stash="stash"
      :write-capability="writeCapability"
      :show-more="showMore"
      :focused-row-id="focusedRowId"
      empty-message="No saved entries"
      :row-model="globalStashRowModel"
      :menu-for="menuFor"
      :menu-label="menuLabel"
      @selected="emit('selected')"
      @menu-select="onMenuSelect"
    />
  </section>
</template>

