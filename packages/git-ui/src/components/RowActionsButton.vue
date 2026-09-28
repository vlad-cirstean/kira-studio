<script setup lang="ts">
// P113 F7: the row-scoped "More actions" ellipsis icon button, repeated across BranchPicker.vue
// (local + remote branch rows), TagList.vue and StashRows.vue — always the same icon, tooltip and
// aria-label, differing only in the click-to-open-menu/contextmenu-to-open-menu handlers a caller
// binds through this component's single-root attrs fallthrough (@click, @contextmenu).
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
</script>

<template>
  <TooltipIconButton icon="ellipsis" label="More actions" />
</template>
