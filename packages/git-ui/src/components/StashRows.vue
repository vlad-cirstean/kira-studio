<script setup lang="ts">
import type { StashEntry } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { cn } from '@theme/lib/utils';
/**
 * I2-21: `StashList.vue`'s and `GlobalStashList.vue`'s own row list, selection and row-menu
 * open/select were byte-identical apart from each row's own label fields (badge/origin/message,
 * `rowModel`), the menu the write-capable branch builds (`menuFor`) and the context menu's own
 * `aria-label` (`menuLabel`, per-entry for `StashList.vue`, static for `GlobalStashList.vue`).
 * The menu id itself is not dispatched here — each caller's own action set genuinely differs
 * (Pop/Drop/`stashSaveGlobal` exist only on a real stack entry), so a selected id is bubbled up
 * via `menuSelect` for the caller's own `switch`.
 */
import { computed, ref } from 'vue';
import type { MenuSection } from '../lib/menuModel.ts';
import { rowVariants } from '../lib/rowVariants.ts';
import type { StashState } from '../state/stash.ts';
import { formatRelativeDate } from './dateFormat.ts';
import type { PickerList } from './pickerModel.ts';
import RowActionsButton from './RowActionsButton.vue';
import RowContextMenu from './RowContextMenu.vue';
import ShowMoreButton from './ShowMoreButton.vue';

export interface StashRowModel {
  /** `data-row-id`/roving-tabindex key — `stash:<sha>` or `global:<sha>`, distinguishing the two
   *  buckets in the shared `focusedRowId` sequence `BranchPicker.vue` owns. */
  readonly id: string;
  /** The row's own tooltip (`StashList.vue`'s base-commit fact) — absent for a global entry, which
   *  has no stack position to report. */
  readonly rowTooltip?: string;
  /** `stash@{N}` — absent for a global entry (D13: position-addressed by necessity, a global entry
   *  has none). */
  readonly badge?: string;
  readonly origin?: string;
  readonly originTooltip?: string;
  readonly auto: boolean;
  readonly message: string;
  readonly messageTooltip: string;
}

const props = defineProps<{
  section: PickerList<StashEntry>;
  stash: StashState;
  showMore: () => void;
  focusedRowId?: string;
  emptyMessage: string;
  rowModel: (entry: StashEntry) => StashRowModel;
  /** The row menu's sections for each bucket. */
  menuFor: (entry: StashEntry) => MenuSection[];
  menuLabel: (entry: StashEntry) => string;
}>();

const emit = defineEmits<{
  (e: 'selected'): void;
  (e: 'menuSelect', id: string, entry: StashEntry): void;
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
  return props.menuFor(entry);
});

function onMenuSelect(id: string): void {
  const entry = stashMenu.value?.entry;
  stashMenu.value = undefined;
  if (!entry) return;
  emit('menuSelect', id, entry);
}
</script>

<template>
  <div
    v-for="entry in section.visible"
    :key="entry.sha"
    class="kv-branch-row flex items-center gap-0.5 px-1"
    :class="{ 'bg-hover': stash.selectedSha.value === entry.sha }"
    :data-kira-tip="rowModel(entry).rowTooltip"
    :data-row-id="rowModel(entry).id"
    :tabindex="focusedRowId === rowModel(entry).id ? 0 : -1"
  >
    <button
      type="button"
      :class="cn(rowVariants(), 'kv-branch-row-main flex-1 min-w-0 text-left')"
      @click="select(entry)"
    >
      <CodiconIcon name="archive" :size="13" />
      <span v-if="rowModel(entry).badge" class="whitespace-nowrap font-data">{{ rowModel(entry).badge }}</span>
      <span
        v-if="rowModel(entry).origin"
        class="whitespace-nowrap text-kira-sm px-1 rounded-kira-sm bg-info text-fg"
        :data-kira-tip="rowModel(entry).originTooltip"
        >{{ rowModel(entry).origin }}</span
      >
      <span
        v-if="rowModel(entry).auto"
        class="whitespace-nowrap text-kira-sm px-1 rounded-kira-sm bg-muted-foreground text-fg"
        data-kira-tip="Created automatically by an auto-stashed checkout"
        >auto</span
      >
      <span class="kv-stash-message flex-1 min-w-0 truncate" :data-kira-tip="rowModel(entry).messageTooltip">{{ rowModel(entry).message }}</span>
      <span v-if="entry.includedUntracked" class="font-data text-kira-sm opacity-80" data-kira-tip="Includes untracked files">-u</span>
      <span class="text-kira-sm text-muted-foreground whitespace-nowrap">{{ entry.fileCount }} file{{ entry.fileCount === 1 ? "" : "s" }}</span>
      <span class="text-kira-sm text-muted-foreground whitespace-nowrap">{{ formatRelativeDate(entry.timestamp) }}</span>
    </button>
    <RowActionsButton
      @click="openMenuFromButton(entry, $event)"
      @contextmenu="openMenu(entry, $event)"
    />
  </div>
  <ShowMoreButton :hidden-count="section.hiddenCount" @click="showMore" />
  <div v-if="section.visible.length === 0" class="py-0.5 px-2 text-muted-foreground text-kira-sm">{{ emptyMessage }}</div>

  <RowContextMenu
    v-if="stashMenu"
    :sections="stashMenuSections"
    :x="stashMenu.x"
    :y="stashMenu.y"
    :label="menuLabel(stashMenu.entry)"
    @select="onMenuSelect"
    @close="stashMenu = undefined"
  />
</template>
