<script setup lang="ts">
import type { Caps } from '@shared/caps';
import AppButton from '@theme/primitives/AppButton.vue';
import Checkbox from '@theme/primitives/Checkbox.vue';
import { ref } from 'vue';
import { useTabsStore } from '../../state/tabs';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import { fieldNamesOnPage } from './page';
import { useDocumentViewStore } from './state';

// Mirrors views/grid/ColumnsMenu.vue's UI pattern exactly (same header buttons, same list, same
// footer line), but a document collection has no catalog to list fields from (§0 note: "Documents'
// 'columns' are dynamic per-document fields") — so the candidate list is `fieldNamesOnPage()`, the
// union of the loaded page's own top-level field names, shared with DocumentView.vue's toolbar
// badge so the two can't drift on how a body is parsed into field names.
const props = defineProps<{ tabId: string; caps: Caps | null }>();
const emit = defineEmits<{ close: [] }>();
const documentViewStore = useDocumentViewStore();

// A snapshot, not a computed: the picker's checkbox list shouldn't reshuffle under the user's
// cursor if a background refresh lands while the popover is open (ColumnsMenu.vue's own
// `columnNames` is a computed only because ObjectMeta is comparatively static; a document page's
// field set is not).
const fieldNames = fieldNamesOnPage(props.tabId);

function currentProjection(): string[] | null {
  return useTabsStore().findDocumentTab(props.tabId)?.state.projection ?? null;
}

const selected = ref<Set<string>>(new Set(currentProjection() ?? fieldNames));

function toggle(name: string): void {
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
function selectAll(): void {
  selected.value = new Set(fieldNames);
}
function selectNone(): void {
  selected.value = new Set();
}

function close(): void {
  const isEverything = selected.value.size === fieldNames.length;
  documentViewStore.setProjection(props.tabId, isEverything ? null : [...selected.value]);
  emit('close');
}
</script>

<template>
  <PopoverPanel
    anchor="right"
    :width="200"
    test-id="document-projection-menu"
    backdrop-test-id="document-projection-menu-backdrop"
    @close="close"
  >
    <div class="columns-menu-inner">
      <div class="columns-menu-header">
        <AppButton data-testid="document-projection-select-all" @click="selectAll"> All </AppButton>
        <AppButton data-testid="document-projection-select-none" @click="selectNone"> None </AppButton>
      </div>
      <div v-if="fieldNames.length === 0" class="columns-menu-loading p-sm muted">
        No fields seen yet — load a page first.
      </div>
      <div v-else class="columns-menu-list">
        <label v-for="name in fieldNames" :key="name" class="columns-menu-item p-row">
          <Checkbox
            :model-value="selected.has(name)"
            data-testid="document-projection-menu-item"
            @update:model-value="toggle(name)"
          />
          {{ name }}
        </label>
      </div>
      <div class="p-sep" />
      <div class="columns-menu-footer p-xs dim" data-testid="document-projection-menu-footer">
        {{ caps?.projection ? 'Applied server-side' : 'Applied after fetch' }} — fields seen on the
        loaded page; `_id` is always returned.
      </div>
    </div>
  </PopoverPanel>
</template>

<style scoped>
@reference "@theme/base.css";

.columns-menu-inner {
  @apply max-h-[320px] flex flex-col;
}

.columns-menu-header {
  @apply flex gap-[var(--kira-s-2)] border-b border-border p-[var(--kira-s-2)];
}

.columns-menu-loading {
  @apply p-[var(--kira-s-4)];
}

.columns-menu-list {
  @apply overflow-y-auto p-[var(--kira-s-1)];
}

.columns-menu-item {
  @apply cursor-pointer;
}

.columns-menu-footer {
  @apply px-[var(--kira-s-3)] pb-[var(--kira-s-3)];
}
</style>
