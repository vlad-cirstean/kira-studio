<script setup lang="ts">
import type { StashEntry } from '@kira/git-ipc';
/**
 * I2-21: `StashList.vue`'s and `GlobalStashList.vue`'s own row list, selection and row-menu
 * open/select were byte-identical apart from each row's own label fields (badge/origin/message,
 * `rowModel`), the menu the write-capable branch builds (`menuFor`) and the context menu's own
 * `aria-label` (`menuLabel`, per-entry for `StashList.vue`, static for `GlobalStashList.vue`).
 * The menu id itself is not dispatched here — each caller's own action set genuinely differs
 * (Pop/Drop/`stashSaveGlobal` exist only on a real stack entry), so a selected id is bubbled up
 * via `menuSelect` for the caller's own `switch`.
 */
import type { MenuSection } from '@kira/kira-ui';
import { KuiButton, kuiRowVariants } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { StashState } from '../state/stash.ts';
import { formatRelativeDate } from './dateFormat.ts';
import type { PickerList } from './pickerModel.ts';
import RowContextMenu from './RowContextMenu.vue';
import { REF_LIST_SECTION_CAP } from './refListModel.ts';
import { buildReadOnlyStashMenu } from './rowMenuModel.ts';

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
  writeCapability: boolean;
  showMore: () => void;
  focusedRowId?: string;
  emptyMessage: string;
  rowModel: (entry: StashEntry) => StashRowModel;
  /** The write-capable menu's own sections — the read-only fallback (`buildReadOnlyStashMenu`) is
   *  the same for both buckets and stays here. */
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
  return props.writeCapability ? props.menuFor(entry) : buildReadOnlyStashMenu();
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
    class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
    :class="{ 'kv:bg-hover': stash.selectedSha.value === entry.sha }"
    v-kui-tooltip="rowModel(entry).rowTooltip"
    :data-row-id="rowModel(entry).id"
    :tabindex="focusedRowId === rowModel(entry).id ? 0 : -1"
  >
    <KuiButton
      :class="[kuiRowVariants(), 'kv-branch-row-main kv:flex-1 kv:min-w-0 kv:text-left']"
      icon="codicon-archive"
      @click="select(entry)"
    >
      <span v-if="rowModel(entry).badge" class="kv:whitespace-nowrap kv:font-data">{{ rowModel(entry).badge }}</span>
      <span
        v-if="rowModel(entry).origin"
        class="kv:whitespace-nowrap kv:text-[0.8em] kv:px-1 kv:rounded-sm kv:bg-stash-origin kv:text-stash-origin-fg"
        v-kui-tooltip="rowModel(entry).originTooltip"
        >{{ rowModel(entry).origin }}</span
      >
      <span
        v-if="rowModel(entry).auto"
        class="kv:whitespace-nowrap kv:text-[0.8em] kv:px-1 kv:rounded-sm kv:bg-stash-auto kv:text-stash-auto-fg"
        v-kui-tooltip="'Created automatically by an auto-stashed checkout'"
        >auto</span
      >
      <span class="kv-stash-message kv:flex-1 kv:min-w-0 kv:truncate" v-kui-tooltip="rowModel(entry).messageTooltip">{{ rowModel(entry).message }}</span>
      <span v-if="entry.includedUntracked" class="kv:font-data kv:text-xs kv:opacity-80" v-kui-tooltip="'Includes untracked files'">-u</span>
      <span class="kv:text-xs kv:text-muted kv:whitespace-nowrap">{{ entry.fileCount }} file{{ entry.fileCount === 1 ? "" : "s" }}</span>
      <span class="kv:text-xs kv:text-muted kv:whitespace-nowrap">{{ formatRelativeDate(entry.timestamp) }}</span>
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
  <KuiButton
    v-if="section.hiddenCount > 0"
    class="kv:block kv:w-full kv:text-left kv:py-0.5 kv:px-2 kv:border-0 kv:text-xs kv:enabled:hover:bg-transparent kv:enabled:hover:underline"
    @click="showMore"
  >
    Show {{ Math.min(REF_LIST_SECTION_CAP, section.hiddenCount) }} more ({{ section.hiddenCount }} remaining)
  </KuiButton>
  <div v-if="section.visible.length === 0" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">{{ emptyMessage }}</div>

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
