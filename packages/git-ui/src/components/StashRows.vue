<script setup lang="ts">
import type { StashEntry } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
/**
 * `StashList.vue`'s and `GlobalStashList.vue`'s own row list, selection and row-menu
 * open/select were byte-identical apart from each row's own label fields (badge/origin/message,
 * `rowModel`) and the menu the write-capable branch builds (`menuFor`).
 * The menu id itself is not dispatched here — each caller's own action set genuinely differs
 * (Pop/Drop/`stashSaveGlobal` exist only on a real stack entry), so a selected id is bubbled up
 * via `menuSelect` for the caller's own `switch`.
 */
import InlineState from '@theme/components/InlineState.vue';
import { Badge } from '@theme/components/ui/badge';
import { t } from '@theme/i18n';
import { rowMeta, rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { formatAgeCompact } from '@workbench/behaviour/format';
import { inject } from 'vue';
import type { MenuSection } from '../lib/menuModel.ts';
import type { PickerList } from '../lib/pickerModel.ts';
import { PICKER_FOCUS_ROW } from '../lib/pickerNav.ts';
import { useSectionMenu } from '../lib/useSectionMenu.ts';
import type { StashState } from '../state/stash.ts';
import RowActionsButton from './RowActionsButton.vue';

const UNTRACKED_FLAG = '-u';

export interface StashRowModel {
  /** `data-row-id`/roving-tabindex key — `stash:<sha>` or `global:<sha>`, distinguishing the two
   *  buckets in the shared `focusedRowId` sequence `RefsPopover.vue` owns. */
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
  focusedRowId?: string;
  emptyMessage: string;
  rowModel: (entry: StashEntry) => StashRowModel;
  /** The row menu's sections for each bucket. */
  menuFor: (entry: StashEntry) => MenuSection[];
}>();

const emit = defineEmits<{
  (e: 'selected'): void;
  (e: 'menuSelect', id: string, entry: StashEntry): void;
}>();

function select(entry: StashEntry): void {
  props.stash.select(entry.sha);
  emit('selected');
}

const rowMenu = useSectionMenu();
const focusRow = inject(PICKER_FOCUS_ROW, () => undefined);

function onContextMenu(event: MouseEvent, entry: StashEntry): void {
  focusRow(props.rowModel(entry).id);
  rowMenu.openAt(event, props.menuFor(entry), (id) => onMenuSelect(entry, id));
}

function onMenuSelect(entry: StashEntry, id: string): void {
  emit('menuSelect', id, entry);
}
</script>

<template>
  <div
    data-testid="branch-row"
    v-for="entry in section.visible"
    :key="entry.sha"
    class="flex items-center gap-0.5 px-1"
    :data-kira-tip="rowModel(entry).rowTooltip"
    :data-row-id="rowModel(entry).id"
    :tabindex="focusedRowId === rowModel(entry).id ? 0 : -1"
  >
    <button
      data-testid="branch-row-main"
      type="button"
      :class="
        cn(
          rowVariants({ selected: stash.selectedSha.value === entry.sha }),
          'flex-1 min-w-0 text-left',
        )
      "
      @click="select(entry)"
    >
      <CodiconIcon name="archive" :size="13" />
      <span v-if="rowModel(entry).badge" class="whitespace-nowrap font-data">{{
        rowModel(entry).badge
      }}</span>
      <Badge
        v-if="rowModel(entry).origin"
        variant="info"
        :data-kira-tip="rowModel(entry).originTooltip"
        >{{
          rowModel(entry).origin
        }}</Badge
      >
      <Badge v-if="rowModel(entry).auto" :data-kira-tip="t('git.stash.auto.hint')">{{
        t('git.stash.auto.label')
      }}</Badge>
      <span
        data-testid="stash-message"
        class="flex-1 min-w-0 truncate"
        :data-kira-tip="rowModel(entry).messageTooltip"
        >{{
          rowModel(entry).message
        }}</span
      >
      <span
        v-if="entry.includedUntracked"
        class="font-data text-kira-sm text-subtle"
        :data-kira-tip="t('git.stash.untracked.hint')"
        >{{
          UNTRACKED_FLAG
        }}</span
      >
      <span :class="cn('whitespace-nowrap', rowMeta)">{{
        t('common.fileCount.label', { count: entry.fileCount })
      }}</span>
      <span :class="cn('whitespace-nowrap', rowMeta)">{{ formatAgeCompact(entry.timestamp) }}</span>
    </button>
    <RowActionsButton
      @click="rowMenu.openFromButton($event, menuFor(entry), (id) => onMenuSelect(entry, id))"
      @contextmenu="onContextMenu($event, entry)"
    />
  </div>
  <InlineState v-if="section.visible.length === 0" kind="empty">{{ emptyMessage }}</InlineState>
</template>
