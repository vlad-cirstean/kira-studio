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
 */
import type { InProgressOperation, StashEntry } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { OpsState } from '../state/ops.ts';
import type { StashState } from '../state/stash.ts';
import { formatRelativeDate } from './dateFormat.ts';
import type { PickerList } from './pickerModel.ts';
import RowContextMenu from './RowContextMenu.vue';
import { REF_LIST_SECTION_CAP } from './refListModel.ts';
import { buildReadOnlyStashMenu, buildStashMenu } from './rowMenuModel.ts';
import { isAutoStash, originLabel, stashLabel } from './stashListModel.ts';

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
  /** C10 §4.2/§4.3 (S6): `false` under the native read-only graph — the row menu falls back to
   *  `buildReadOnlyStashMenu` (Show changes only) instead of `buildStashMenu`. */
  writeCapability: boolean;
  /** P77 §6.3: raises this tab's own cap — see `TagList.vue`'s own doc comment on this prop. */
  showMore: () => void;
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

function select(entry: StashEntry): void {
  props.stash.select(entry.sha);
  emit('selected');
}

const stashMenu = ref<{ entry: StashEntry; x: number; y: number } | undefined>(undefined);

function openMenu(entry: StashEntry, event: MouseEvent): void {
  event.preventDefault();
  stashMenu.value = { entry, x: event.clientX, y: event.clientY };
}

function openMenuFromButton(entry: StashEntry, event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  stashMenu.value = { entry, x: rect.left, y: rect.bottom };
}

const stashMenuSections = computed(() => {
  const entry = stashMenu.value?.entry;
  if (!entry) return [];
  return props.writeCapability
    ? buildStashMenu(props.inProgress, entry, props.currentBranch ?? null)
    : buildReadOnlyStashMenu();
});

async function onMenuSelect(id: string): Promise<void> {
  const entry = stashMenu.value?.entry;
  stashMenu.value = undefined;
  if (!entry) return;
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
      select(entry);
      return;
    default:
      return;
  }
}
</script>

<template>
  <div class="kv-branch-section" aria-label="Stashes">
    <div class="kv-branch-section-title">Stashes</div>
    <div
      v-for="entry in section.visible"
      :key="entry.sha"
      class="kv-branch-row"
      :class="{ 'kv-stash-row--selected': stash.selectedSha.value === entry.sha }"
      v-kui-tooltip="`Base: ${entry.baseSha.slice(0, 7)} ${entry.baseSubject}`"
      :data-row-id="`stash:${entry.sha}`"
      :tabindex="focusedRowId === `stash:${entry.sha}` ? 0 : -1"
    >
      <KuiButton class="kui-row kv-branch-row-main" icon="codicon-archive" @click="select(entry)">
        <span class="kv-stash-index">{{
          // A template literal here would put two closing braces back to back, which this Vue
          // parser reads as the mustache's own closing delimiter mid-expression.
          // biome-ignore lint/style/useTemplate: see above
          "stash@{" + entry.index + "}"
        }}</span>
        <span
          v-if="originLabel(entry, currentBranch)"
          class="kv-stash-origin"
          v-kui-tooltip="`Stashed from ${originLabel(entry, currentBranch)}`"
          >{{ originLabel(entry, currentBranch) }}</span
        >
        <span v-if="isAutoStash(entry)" class="kv-stash-auto" v-kui-tooltip="'Created automatically by an auto-stashed checkout'">auto</span>
        <span class="kv-stash-message" v-kui-tooltip="entry.message">{{ stashLabel(entry) }}</span>
        <span v-if="entry.includedUntracked" class="kv-stash-untracked" v-kui-tooltip="'Includes untracked files'">-u</span>
        <span class="kv-stash-filecount">{{ entry.fileCount }} file{{ entry.fileCount === 1 ? "" : "s" }}</span>
        <span class="kv-stash-date">{{ formatRelativeDate(entry.timestamp) }}</span>
      </KuiButton>
      <KuiButton
        variant="icon"
        v-kui-tooltip="'More actions'"
        aria-label="More actions"
        @click="openMenuFromButton(entry, $event)"
        @contextmenu="openMenu(entry, $event)"
      >
        <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
      </KuiButton>
    </div>
    <KuiButton v-if="section.hiddenCount > 0" class="kv-branch-more-button" @click="showMore">
      Show {{ Math.min(REF_LIST_SECTION_CAP, section.hiddenCount) }} more ({{ section.hiddenCount }} remaining)
    </KuiButton>
    <div v-if="section.visible.length === 0" class="kv-branch-empty">No stashes</div>

    <RowContextMenu
      v-if="stashMenu"
      :sections="stashMenuSections"
      :x="stashMenu.x"
      :y="stashMenu.y"
      :label="`stash@{${stashMenu.entry.index}} actions`"
      @select="onMenuSelect"
      @close="stashMenu = undefined"
    />
  </div>
</template>

<style>
.kv-stash-row--selected {
  background-color: var(--kv-row-hover-bg);
}

.kv-stash-index {
  white-space: nowrap;
  font-family: var(--kv-mono-font-family);
}

.kv-stash-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-stash-untracked {
  font-family: var(--kv-mono-font-family);
  font-size: 0.85em;
  opacity: 0.8;
}

.kv-stash-origin {
  white-space: nowrap;
  font-size: 0.8em;
  padding: 0 0.4em;
  border-radius: 3px;
  background-color: var(--kv-stash-origin-bg);
  color: var(--kv-stash-origin-fg);
}

.kv-stash-auto {
  white-space: nowrap;
  font-size: 0.8em;
  padding: 0 0.4em;
  border-radius: 3px;
  background-color: var(--kv-stash-auto-bg);
  color: var(--kv-stash-auto-fg);
}

.kv-stash-filecount,
.kv-stash-date {
  font-size: 0.85em;
  color: var(--kv-description-fg);
  white-space: nowrap;
}
</style>
