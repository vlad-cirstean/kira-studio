<script setup lang="ts">
// P113 F7: the ref-list picker's "Show N more (M remaining)" affordance, repeated across
// BranchPicker.vue (local + remote branches), TagList.vue and StashRows.vue — every list capped by
// REF_LIST_SECTION_CAP. Not LoadMoreButton.vue: that one pages CommitGrid's graph stream
// (graphView/pageSize, an Alt-click "load everything" mode, a Cancel affordance) — a different
// shape for a different kind of list. `@click` reaches the caller's own `showMore` through this
// component's single-root attrs fallthrough.
import { KuiButton } from '@kira/kira-ui';
import { REF_LIST_SECTION_CAP } from './refListModel.ts';

defineProps<{ hiddenCount: number }>();
</script>

<template>
  <KuiButton
    v-if="hiddenCount > 0"
    class="kv:block kv:w-full kv:text-left kv:py-0.5 kv:px-2 kv:border-0 kv:text-sm kv:enabled:hover:bg-transparent kv:enabled:hover:underline"
  >
    Show {{ Math.min(REF_LIST_SECTION_CAP, hiddenCount) }} more ({{ hiddenCount }} remaining)
  </KuiButton>
</template>
