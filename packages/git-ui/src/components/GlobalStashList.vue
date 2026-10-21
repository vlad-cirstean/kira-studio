<script setup lang="ts">
/**
 * The global stash bucket's own section — `StashList.vue`'s structure, with
 * `stash@{N}` replaced by the origin-branch chip and the label (`globalRowModel`), and a header
 * "Save to global stash…" button that opens `StashDialog.vue`'s fourth mode (bubbled to
 * `App.vue`, mirroring `branchFromStash`'s own "this component owns no dialog of its own" shape).
 * Row menu: Apply here, Create branch from this…, Show changes, Remove from global stash — no
 * Pop, no Drop (`buildGlobalStashMenu`, both are position-addressed by necessity and a
 * global entry has no stack position at all).
 *
 * Renders the already filtered/ordered/capped `section` prop `pickerModel.ts` hands it —
 * the same `TagList.vue`/`StashList.vue` contract, this component owns no fold of its own.
 *
 * The row list itself lives in `StashRows.vue`, shared with `StashList.vue` — see that
 * file's own doc comment.
 */
import type { InProgressOperation, StashEntry } from '@kira/git-ipc';
import SectionHeading from '@theme/components/SectionHeading.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
import type { PickerList } from '../lib/pickerModel.ts';
import { buildGlobalStashMenu } from '../lib/rowMenuModel.ts';
import { globalRowModel } from '../lib/stashListModel.ts';
import type { OpsState } from '../state/ops.ts';
import type { StashState } from '../state/stash.ts';
import StashRows, { type StashRowModel } from './StashRows.vue';

const props = defineProps<{
  section: PickerList<StashEntry>;
  stash: StashState;
  ops: OpsState;
  inProgress: InProgressOperation | null;
  currentBranch?: string | null;
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
    originTooltip:
      model.origin === undefined
        ? undefined
        : t('git.stash.savedFrom.tooltip', { origin: model.origin }),
    auto: model.auto,
    message: model.label,
    messageTooltip: entry.message,
  };
}

function menuFor(entry: StashEntry) {
  return buildGlobalStashMenu(props.inProgress, entry, props.currentBranch ?? null);
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
  <section :aria-label="t('git.stash.global.label')">
    <SectionHeading :label="t('git.stash.global.label')">
      <TooltipIconButton
        icon="add"
        :label="t('git.stash.saveGlobal.tooltip')"
        @click="emit('saveGlobalStash')"
      />
    </SectionHeading>
    <StashRows
      :section="section"
      :stash="stash"
      :focused-row-id="focusedRowId"
      :empty-message="t('git.stash.globalEmpty.empty')"
      :row-model="globalStashRowModel"
      :menu-for="menuFor"
      @selected="emit('selected')"
      @menu-select="onMenuSelect"
    />
  </section>
</template>
