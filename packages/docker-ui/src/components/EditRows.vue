<script setup lang="ts" generic="T">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';

defineProps<{ items: T[]; addLabel: string; disabled?: boolean; testid: string }>();
const emit = defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <div class="flex flex-col gap-1.5" :data-testid="testid">
    <div v-for="(item, index) in items" :key="index" class="flex items-center gap-1.5" data-testid="docker-edit-row">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <slot name="row" :item="item" :index="index" />
      </div>
      <TooltipIconButton
        icon="trash"
        label="Remove"
        :disabled="disabled"
        data-testid="docker-edit-row-remove"
        @click="emit('remove', index)"
      />
    </div>
    <Button
      size="kira"
      variant="secondary"
      class="self-start"
      :disabled="disabled"
      data-testid="docker-edit-row-add"
      @click="emit('add')"
    >
      {{ addLabel }}
    </Button>
  </div>
</template>
