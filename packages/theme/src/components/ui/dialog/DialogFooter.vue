<script setup lang="ts">
import { Button } from '@theme/components/ui/button'
import { cn } from '@theme/lib/utils'
import { DialogClose } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  showCloseButton?: boolean
}>(), {
  showCloseButton: false,
})
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('flex items-center gap-1.5 border-t border-border px-3 py-2', props.class)"
  >
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="outline">
        Close
      </Button>
    </DialogClose>
  </div>
  <!-- P110 I2-21 (§3.10, M9): the old base's `-mx-4 -mb-4` bled the footer 16px past
       DialogContent's own padded box on all three measured edges (left/right/bottom), measured
       against the real connection-dialog harness before this change. Mirrors DialogHeader's own
       base instead, per §1.4's overshoot-conditional disclosure. Affected dialog visual baselines
       re-recorded in this commit. ConfirmDialog.vue's own bare usage (the one no-override
       consumer) keeps its old look via an explicit compensating class. -->
</template>
