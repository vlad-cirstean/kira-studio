<script setup lang="ts">
import type { Caps } from '@shared/caps';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { Separator } from '@theme/components/ui/separator';
import { onUnmounted, ref } from 'vue';
import { useTabsStore } from '../../state/tabs';
import { fieldNamesOnPage } from './page';
import { nextDocumentProjectionOnClose } from './projection';
import { useDocumentViewStore } from './state';

// Mirrors views/grid/ColumnsMenu.vue's UI pattern exactly (same header buttons, same list, same
// footer line), but a document collection has no catalog to list fields from (§0 note: "Documents'
// 'columns' are dynamic per-document fields") — so the candidate list is `fieldNamesOnPage()`, the
// union of the loaded page's own top-level field names, shared with DocumentView.vue's toolbar
// badge so the two can't drift on how a body is parsed into field names.
const props = defineProps<{ tabId: string; caps: Caps | null }>();
const documentViewStore = useDocumentViewStore();

// A snapshot, not a computed: the picker's checkbox list shouldn't reshuffle under the user's
// cursor if a background refresh lands while the popover is open (ColumnsMenu.vue's own
// `columnNames` is a computed only because ObjectMeta is comparatively static; a document page's
// field set is not).
const fieldNames = fieldNamesOnPage(props.tabId);

function currentProjection(): string[] | null {
  return useTabsStore().findDocumentTab(props.tabId)?.state.projection ?? null;
}

// P108 Part 11 F6: the projection the menu opened with, kept apart from `selected` (which the
// checkboxes mutate) so an untouched close can tell "nothing changed" from "the user chose the
// same fields All would" — see onUnmounted below. Note fieldNames is itself the *already
// projected* page's own field set, so it can legitimately equal the active projection exactly
// (a projection to [a, b] leaves the page showing only _id, a, b) — that equality is not, on its
// own, evidence the user wants "everything".
const initialProjection = currentProjection();
const initialSelected = new Set(initialProjection ?? fieldNames);
const selected = ref<Set<string>>(new Set(initialSelected));

// F6: "everything" is only ever what an explicit All press means, never inferred from `selected`
// happening to match fieldNames.length by coincidence (the projected-page-equals-its-own-
// projection case above). Toggling a single checkbox, or None, is never "everything" either, even
// if a toggle-back-on later makes the set match fieldNames again.
let explicitAll = false;

function toggle(name: string): void {
  explicitAll = false;
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
function selectAll(): void {
  explicitAll = true;
  selected.value = new Set(fieldNames);
}
function selectNone(): void {
  explicitAll = false;
  selected.value = new Set();
}

// P104 §3: PopoverPanel's own close-commits-selection contract, preserved by committing on
// unmount instead of on a `close` emit -- the caller's Popover (ui/popover) unmounts this
// component's content on close for every reason (outside click, Escape, or the toolbar toggle
// button), the same set PopoverPanel's own hand-rolled backdrop+Escape handling covered.
onUnmounted(() => {
  const next = nextDocumentProjectionOnClose(
    selected.value,
    initialSelected,
    fieldNames.length,
    explicitAll,
  );
  if (next === undefined) return;
  documentViewStore.setProjection(props.tabId, next);
});
</script>

<template>
  <div class="columns-menu-inner">
    <div class="columns-menu-header">
      <Button variant="toolbar" size="kira" data-testid="document-projection-select-all" @click="selectAll"
        >All</Button
      >
      <Button variant="toolbar" size="kira" data-testid="document-projection-select-none" @click="selectNone"
        >None</Button
      >
    </div>
    <div v-if="fieldNames.length === 0" class="columns-menu-loading text-kira-sm text-muted-foreground">
      No fields seen yet — load a page first.
    </div>
    <div v-else class="columns-menu-list">
      <Label v-for="name in fieldNames" :key="name" class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover">
        <Checkbox
          :model-value="selected.has(name)"
          class="size-3.5"
          data-testid="document-projection-menu-item"
          @update:model-value="toggle(name)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        {{ name }}
      </Label>
    </div>
    <Separator class="my-1" />
    <div class="columns-menu-footer text-kira-xs text-subtle" data-testid="document-projection-menu-footer">
      {{ caps?.projection ? 'Applied server-side' : 'Applied after fetch' }} — fields seen on the
      loaded page; `_id` is always returned.
    </div>
  </div>
</template>
