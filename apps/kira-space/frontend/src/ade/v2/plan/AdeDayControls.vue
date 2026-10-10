<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';

// The Later band's row: `+ week` grows the horizon, `or date` appends one future day.
defineProps<{ minDate: string }>();
const emit = defineEmits<{ moreWeek: []; pickDate: [iso: string] }>();

function onDate(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit('pickDate', v);
}
</script>

<template>
  <div class="flex">
    <div class="w-15 shrink-0 border-r-2 border-border-strong" />
    <div class="flex items-center gap-2 pb-2 pl-2 pt-1">
      <Button variant="dialog" size="kira" class="border-dashed" data-testid="ade-more-week" @click="emit('moreWeek')">
        + week
      </Button>
      <Label for="ade-add-day" class="font-normal text-kira-sm text-muted-foreground">or date</Label>
      <Input
        id="ade-add-day"
        type="date"
        size="kira"
        :min="minDate"
        class="w-36 scheme-dark"
        data-testid="ade-add-day"
        @input="onDate"
      />
    </div>
  </div>
</template>
