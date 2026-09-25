<script setup lang="ts">
// P113 F7: the row-scoped "More actions" ellipsis icon button, repeated across BranchPicker.vue
// (local + remote branch rows), TagList.vue and StashRows.vue — always the same icon, tooltip and
// aria-label, differing only in the click-to-open-menu/contextmenu-to-open-menu handlers a caller
// binds through this component's single-root attrs fallthrough (@click, @contextmenu).
//
// git-ui has no dependency on packages/theme (it's shared with the VS Code webview, which bundles
// independently) — mirrors F2's TooltipIconButton in shape only, built on kira-ui's own KuiButton
// and its `v-kui-tooltip` directive rather than theme's Tooltip/Button.
import { KuiButton } from '@kira/kira-ui';
</script>

<template>
  <KuiButton variant="icon" v-kui-tooltip="'More actions'" aria-label="More actions">
    <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
  </KuiButton>
</template>
