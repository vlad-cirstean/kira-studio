<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { copyOrReportError } from '@workbench/util/clipboard';
import { ref } from 'vue';

// A "click for full text" replacement for truncated inline error text (unreadable in a native
// title tooltip for multi-line/long messages, and unreachable on touch).
const props = defineProps<{ message: string }>();

const open = ref(false);
const copyError = ref<string | null>(null);

function onCopy(): void {
  copyError.value = null;
  void copyOrReportError(props.message, (m) => {
    copyError.value = m;
  });
}
</script>

<template>
  <span class="min-w-0 ml-auto shrink">
    <Popover v-model:open="open" @update:open="copyError = null">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="flex items-center min-w-0 max-w-full bg-transparent border-none p-0 cursor-pointer gap-1 text-error text-kira-md"
          data-testid="error-popover-trigger"
          :aria-label="`Error: ${props.message}`"
          @click.stop
        >
          <CodiconIcon name="error" :size="13" />
          <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ props.message }}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        class="border border-border-strong shadow-kira-dialog overflow-hidden w-80 max-h-60 gap-0 p-0 z-(--kira-z-menu) max-w-[calc(100vw-8px)]"
        data-testid="error-popover"
      >
        <div class="overflow-auto whitespace-pre-wrap break-words p-2 text-error font-data">{{ props.message }}</div>
        <div v-if="copyError" class="px-2 pb-1 text-kira-sm text-error" data-testid="error-popover-copy-error">
          Copy failed: {{ copyError }}
        </div>
        <!-- Footer is the same 28px band used everywhere a toolbar sits at the edge of a floating
             surface, with the border on top since this one closes the popover. -->
        <ViewToolbar border="top">
          <Button variant="toolbar" size="kira" class="ml-auto" @click="onCopy">Copy</Button>
          <Button variant="toolbar" size="kira" @click="open = false">Close</Button>
        </ViewToolbar>
      </PopoverContent>
    </Popover>
  </span>
</template>
