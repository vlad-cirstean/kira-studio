<script setup lang="ts">
/**
 * G19 D3b: a thin compatibility wrapper over `@kira/kira-ui`'s `KuiContextMenu` — the ARIA-menu/
 * keyboard-nav logic that used to live here directly has been promoted, verbatim, to that
 * package (`contextMenuModel.ts`); this file forwards its own external API — every prop and
 * every emit — straight through, byte-identically to before. Kept as a file (not inlined at each
 * call site) so this component's 8 existing consumers, `StashList.vue` (a G17 file, actively
 * being written concurrently with this phase) included, need zero edits: every one of them still
 * imports `RowContextMenu.vue` and passes the exact same props it always did.
 */
import { KuiContextMenu } from '@kira/kira-ui';
import type { MenuSection } from './rowMenuModel.ts';

defineProps<{
  sections: readonly MenuSection[];
  x: number;
  y: number;
  label: string;
  title?: string;
}>();

defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();
</script>

<template>
  <KuiContextMenu
    :sections="sections"
    :x="x"
    :y="y"
    :label="label"
    :title="title"
    @select="(id) => $emit('select', id)"
    @close="$emit('close')"
  />
</template>
