<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import AdeActivityGlyph from './AdeActivityGlyph.vue';
import { ACTIVITY_LABEL, type ActivityKind } from './activity';

// P129 Part 3 §0.18/§2.7: mockup line 663-670's own `act()` shapes at its `z = 12` size — the only
// size Part 3 renders (repo tabs, §0.18's own note: "Part 3 renders them in repo tabs"). Tints stay
// literal data values (design §2.1), never theme tokens — an activity glyph reads the same in every
// theme. P129 Part 5 §0.18 extracts the glyph itself into `AdeActivityGlyph.vue` (the agents pill's
// own 13px size); this component keeps its tooltip wrapper, unchanged at 12px.
const props = defineProps<{ kind: ActivityKind }>();

const label = computed(() => ACTIVITY_LABEL[props.kind]);
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span :aria-label="label" class="inline-flex">
        <AdeActivityGlyph :kind="kind" :size="12" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
