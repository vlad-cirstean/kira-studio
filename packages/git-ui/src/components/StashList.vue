<script setup lang="ts">
/**
 * `docs/plans/P9.md` W14 (§3.1, §7.6's "dedicated stash list"; OQ3 puts it beside `TagList.vue`,
 * inside `BranchPicker.vue`). One row per `StashEntry`: message, relative date, file count and a
 * `-u` marker. There is no filter box here (unlike `TagList.vue`) — `BranchPicker.vue`'s own
 * filter now scopes to the active tab (P77 §5) and hands this component an already filtered/
 * capped `section` prop, the same `TagList.vue` contract (P77 §11) — this component owns no fold
 * of its own any more.
 *
 * P77 §7.1: the base-commit column (short sha + `baseSubject`) is gone from the row — the fact is
 * unchanged and stated in full by `StashDetailPane.vue` the instant the row is selected, and its
 * reserved width was crowding out the user's own label. It survives as the row's own tooltip.
 *
 * A row click selects the entry (`StashState.select`, OQ4) — it does not apply/pop it; that is
 * what the row's own menu (`buildStashMenu`) is for, mirroring `TagList.vue`'s own "click checks
 * out, menu does everything else" split as closely as a non-checkout row can.
 *
 * I2-21: the row list itself (selection, row-menu open/select, `Show N more`/empty markup) moved
 * to `StashRows.vue`, shared with `GlobalStashList.vue` — this file keeps its own row fields
 * (`stashRowModel`) and its own menu action set (Pop/Drop/`stashSaveGlobal` exist only on a real
 * stack entry, never on a global bucket one).
 */
import type { InProgressOperation, StashEntry } from '@kira/git-ipc';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { t } from '@theme/i18n';
import type { PickerList } from '../lib/pickerModel.ts';
import { buildStashMenu } from '../lib/rowMenuModel.ts';
import { isAutoStash, originLabel, stashLabel } from '../lib/stashListModel.ts';
import { shaLabel } from '../lib/text.ts';
import type { OpsState } from '../state/ops.ts';
import type { StashState } from '../state/stash.ts';
import StashRows, { type StashRowModel } from './StashRows.vue';

const props = defineProps<{
  /** P77 §11: already filtered/ordered/capped by `pickerModel.ts` — this component only renders
   *  it, the same contract `TagList.vue` has had since P6. */
  section: PickerList<StashEntry>;
  stash: StashState;
  ops: OpsState;
  inProgress: InProgressOperation | null;
  /** G28 D5: the currently checked-out branch — `undefined`/`null` for a detached HEAD. Drives
   *  the origin-branch chip and `buildStashMenu`'s own cross-branch Apply label/Pop suppression. */
  currentBranch?: string | null;
  /** P77 §7.3 — see `TagList.vue`'s own doc comment on this prop. */
  focusedRowId?: string;
}>();

/** Bubbled to `BranchPicker.vue` → `App.vue`, which owns `StashDialog.vue`'s branch-mode state —
 *  mirroring `createBranchHere`'s own App.vue-owned dialog state (this component has nowhere of
 *  its own to render a name-entry dialog into). `saveEntryToGlobalStash` (G28 D13) is the same
 *  shape for the save-mode's own pre-selected source. */
const emit = defineEmits<{
  (e: 'branchFromStash', entry: StashEntry): void;
  (e: 'saveEntryToGlobalStash', entry: StashEntry): void;
  /** P77 §14 (N9): `BranchPicker.vue` closes the panel through `closeForCheckout()` on this — the
   *  same focus-to-trigger-before-close fix a checkout already gets, so the pane the click fills
   *  is not left behind the popover. */
  (e: 'selected'): void;
}>();

function stashRowModel(entry: StashEntry): StashRowModel {
  const origin = originLabel(entry, props.currentBranch);
  return {
    id: `stash:${entry.sha}`,
    rowTooltip: t('git.stash.base.tooltip', {
      sha: shaLabel(entry.baseSha),
      subject: entry.baseSubject,
    }),
    badge: `stash@{${entry.index}}`,
    origin,
    originTooltip:
      origin === undefined ? undefined : t('git.stash.stashedFrom.tooltip', { origin }),
    auto: isAutoStash(entry),
    message: stashLabel(entry),
    messageTooltip: entry.message,
  };
}

function menuFor(entry: StashEntry) {
  return buildStashMenu(props.inProgress, entry, props.currentBranch ?? null);
}

async function onMenuSelect(id: string, entry: StashEntry): Promise<void> {
  switch (id) {
    case 'stashApply':
      await props.ops.runStashApply(entry);
      return;
    case 'stashPop':
      await props.ops.runStashPop(entry);
      return;
    case 'stashDrop':
      await props.ops.runStashDrop(entry);
      return;
    case 'stashBranch':
      emit('branchFromStash', entry);
      return;
    case 'stashSaveGlobal':
      emit('saveEntryToGlobalStash', entry);
      return;
    case 'stashShow':
      props.stash.select(entry.sha);
      emit('selected');
      return;
    default:
      return;
  }
}
</script>

<template>
  <section data-testid="branch-section" :aria-label="t('git.stash.list.label')">
    <SectionHeading :label="t('git.stash.list.label')" />
    <StashRows
      :section="section"
      :stash="stash"
      :focused-row-id="focusedRowId"
      :empty-message="t('git.stash.list.empty')"
      :row-model="stashRowModel"
      :menu-for="menuFor"
      @selected="emit('selected')"
      @menu-select="onMenuSelect"
    />
  </section>
</template>
