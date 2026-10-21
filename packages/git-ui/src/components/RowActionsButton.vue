<script setup lang="ts">
// The row-scoped "More actions" ellipsis icon button, repeated across BranchPicker.vue
// (local + remote branch rows), TagList.vue and StashRows.vue — always the same icon, tooltip and
// aria-label, differing only in the click-to-open-menu/contextmenu-to-open-menu handlers a caller
// binds through this component's single-root attrs fallthrough (@click, @contextmenu).
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
</script>

<template>
  <TooltipIconButton
    icon="ellipsis"
    data-testid="row-actions"
    :label="t('common.moreActions.tooltip')"
  />
</template>
