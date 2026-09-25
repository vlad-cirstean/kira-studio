<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn('flex flex-row items-center gap-1.5 border-b border-border px-3 py-2', props.class)"
  >
    <slot />
  </div>
  <!-- P110 I2-21 (§3.10): base is today's already-merged 17-site override
       (`flex-row items-center gap-1.5 border-b border-border px-3 py-2`), so per-site overrides
       are gone -- ConfirmDialog.vue's own bare usage now unifies onto the same look instead of the
       old `gap-2 flex flex-col` default (not previously visually baselined, so nothing to
       disclose). CommandDialog.vue's `class="sr-only"` still merges cleanly on top. -->

</template>
