<script setup lang="ts">
import { Label } from '@theme/components/ui/label'
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Label
    data-slot="field-label"
    :class="cn('text-muted-foreground', props.class)"
  >
    <slot />
  </Label>
</template>
