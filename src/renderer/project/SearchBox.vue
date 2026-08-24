<script setup lang="ts">
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';
import { treeState } from './state/tree';
</script>

<template>
  <div class="search-box-row">
    <div class="search-box">
      <TextField
        v-model="treeState.search"
        ui
        icon="search"
        placeholder="Search"
        data-testid="tree-search"
      />
      <IconButton
        v-if="treeState.search"
        icon="close"
        :size="12"
        class="clear-button"
        v-tooltip="'Clear search'"
        aria-label="Clear search"
        @click="treeState.search = ''"
      />
    </div>
  </div>
</template>

<style scoped>
/* Menus.html's "Columns" filter row: a bordered p-input inset with padding
   from the panel edge, above a hairline that separates it from the list. */
.search-box-row {
  flex-shrink: 0;
  padding: var(--kira-s-2) var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner
   <input> (see TextField.vue's inheritAttrs:false), so the "grow to fill" sizing moves onto
   this wrapper instead of a style/class attribute on the component tag itself (DocumentView.vue
   precedent) — and the clear button, which used to be a third flex child inside the bordered
   box, is now overlaid on top of it since TextField has no slot for trailing content. */
.search-box {
  width: 100%;
  position: relative;
}

.search-box :deep(.p-input) {
  width: 100%;
}

.search-box :deep(input) {
  padding-right: var(--kira-s-6);
}

.clear-button {
  position: absolute;
  top: 50%;
  right: var(--kira-s-1);
  transform: translateY(-50%);
  flex-shrink: 0;
}
</style>
