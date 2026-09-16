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
import { buildGlobalStashMenu, buildReadOnlyStashMenu } from './rowMenuModel.ts';
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
}>();

function select(entry: StashEntry): void {
  props.stash.select(entry.sha);
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
    ? buildGlobalStashMenu(props.inProgress, entry, props.currentBranch ?? null)
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
    case 'stashBranch':
      emit('branchFromStash', entry);
      return;
    case 'stashShow':
      select(entry);
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
  <div class="kv-branch-section" aria-label="Global stash">
    <div class="kv-branch-section-title kv-global-stash-title">
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
    <div
      v-for="entry in section.visible"
      :key="entry.sha"
      class="kv-branch-row"
      :class="{ 'kv-stash-row--selected': stash.selectedSha.value === entry.sha }"
      :data-row-id="`global:${entry.sha}`"
      :tabindex="focusedRowId === `global:${entry.sha}` ? 0 : -1"
    >
      <KuiButton class="kui-row kv-branch-row-main" icon="codicon-archive" @click="select(entry)">
        <span
          v-if="globalRowModel(entry).origin"
          class="kv-stash-origin"
          v-kui-tooltip="'Saved from ' + globalRowModel(entry).origin"
          >{{ globalRowModel(entry).origin }}</span
        >
        <span v-if="globalRowModel(entry).auto" class="kv-stash-auto" v-kui-tooltip="'Created automatically by an auto-stashed checkout'">auto</span>
        <span class="kv-stash-message" v-kui-tooltip="entry.message">{{ globalRowModel(entry).label }}</span>
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
    <div v-if="section.visible.length === 0" class="kv-branch-empty">No saved entries</div>

    <RowContextMenu
      v-if="stashMenu"
      :sections="stashMenuSections"
      :x="stashMenu.x"
      :y="stashMenu.y"
      label="Global stash entry actions"
      @select="onMenuSelect"
      @close="stashMenu = undefined"
    />
  </div>
</template>

<style>
.kv-global-stash-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* G34: `.kv-global-stash-save` is gone — `variant="icon"` is this icon-only button's box now. */
</style>
