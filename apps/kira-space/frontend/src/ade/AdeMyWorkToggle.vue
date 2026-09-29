<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { MY_WORK_LIMIT } from './myWorkCap';

// P136: sits under the main line while stacks are capped, or while expanded after a reveal.
defineProps<{ hiddenCount: number; expanded: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <div
    class="flex items-center gap-1.5 px-3.5 pb-1 text-kira-sm text-[#9a9ca5]"
    data-testid="ade-my-work-toggle"
  >
    <template v-if="!expanded">
      <span>Top {{ MY_WORK_LIMIT }} of my work ·</span>
      <Button variant="link" size="sm" class="h-5 px-0" data-testid="ade-show-more" @click="emit('toggle')">
        Show {{ hiddenCount }} more
      </Button>
    </template>
    <Button v-else variant="link" size="sm" class="h-5 px-0" data-testid="ade-show-more" @click="emit('toggle')">
      Show top {{ MY_WORK_LIMIT }} only
    </Button>
  </div>
</template>
