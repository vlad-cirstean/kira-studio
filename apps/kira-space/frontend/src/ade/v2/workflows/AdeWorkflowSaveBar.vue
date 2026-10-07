<script setup lang="ts">
import { Button } from '@theme/components/ui/button';

// Save and Discard for the open workflow editor; both are off while nothing is edited.
defineProps<{ dirty: boolean; saving: boolean }>();
const emit = defineEmits<{ save: []; discard: [] }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="ade-wf-savebar">
    <span class="min-w-0 flex-1 text-kira-sm text-subtle">Saved edits apply to work not yet started.</span>
    <Button variant="dialog" size="kira-lg" :disabled="!dirty || saving" data-testid="ade-wf-discard" @click="emit('discard')">
      Discard
    </Button>
    <Button variant="dialog-primary" size="kira-lg" :disabled="!dirty || saving" data-testid="ade-wf-save" @click="emit('save')">
      Save
    </Button>
  </div>
</template>
