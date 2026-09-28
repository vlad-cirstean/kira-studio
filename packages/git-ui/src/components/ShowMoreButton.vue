<script setup lang="ts">
// P113 F7: the ref-list picker's "Show N more (M remaining)" affordance, repeated across
// BranchPicker.vue (local + remote branches), TagList.vue and StashRows.vue — every list capped by
// REF_LIST_SECTION_CAP. Not LoadMoreButton.vue: that one pages CommitGrid's graph stream
// (graphView/pageSize, an Alt-click "load everything" mode, a Cancel affordance) — a different
// shape for a different kind of list. `@click` reaches the caller's own `showMore` through this
// component's single-root attrs fallthrough.
import { Button } from '@theme/components/ui/button';
import { REF_LIST_SECTION_CAP } from './refListModel.ts';

defineProps<{ hiddenCount: number }>();
</script>

<template>
  <Button
    v-if="hiddenCount > 0"
    variant="link"
    size="kira"
    class="w-full justify-start px-2 py-0.5 h-auto text-muted-foreground"
  >
    Show {{ Math.min(REF_LIST_SECTION_CAP, hiddenCount) }} more ({{ hiddenCount }} remaining)
  </Button>
</template>
