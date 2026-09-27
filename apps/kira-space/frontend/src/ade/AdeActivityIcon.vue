<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import type { ActivityKind } from './activity';

// P129 Part 3 §0.18/§2.7: mockup line 663-670's own `act()` shapes at its `z = 12` size — the only
// size Part 3 renders (repo tabs, §0.18's own note: "Part 3 renders them in repo tabs"). Tints stay
// literal data values (design §2.1), never theme tokens — an activity glyph reads the same in every
// theme. Glyph text sits on text-kira-sm (chrome's own four-value scale floor, P123 §6.2/
// check-theme-classes.sh's own check_font_scale) rather than the mockup's literal 7-8px — no size
// below that floor exists in this app's chrome.
const props = defineProps<{ kind: ActivityKind }>();

const LABEL: Record<ActivityKind, string> = {
  input: 'needs input',
  working: 'working',
  waiting: 'waiting on monitor',
  idle: 'idle',
  stopped: 'stopped',
};

const label = computed(() => LABEL[props.kind]);
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        :data-activity="kind"
        :aria-label="label"
        class="inline-flex shrink-0 items-center justify-center"
      >
        <span
          v-if="kind === 'input'"
          class="flex size-3 items-center justify-center rounded-full bg-[#e8a33d] text-kira-sm font-extrabold leading-none text-[#15161a]"
          >!</span
        >
        <span
          v-else-if="kind === 'working'"
          class="m-0.5 inline-block size-2 rounded-full bg-[#6cc58a] shadow-[0_0_0_2px_rgba(108,197,138,0.28)]"
        />
        <span
          v-else-if="kind === 'waiting'"
          class="flex size-3 items-center justify-center rounded-full border-[1.5px] border-[#7aa7ff] text-kira-sm font-bold leading-none text-[#93b6ff]"
          >z</span
        >
        <span
          v-else-if="kind === 'idle'"
          class="m-0.5 inline-block size-2 rounded-full border-[1.5px] border-[#7c7f88]"
        />
        <span v-else class="m-[3px] inline-block size-1.5 rounded-[2px] bg-[#4a4d56]" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
