<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { ref } from 'vue';

// P128 §2.3: hoisted from Kira Studio's own WorkbenchShell.vue (the automations module's own "+") and
// Kira Space's own WorkbenchShell.vue (the git module's own "+") — the wrapper/Tooltip/button
// markup was already identical between the two; only the label, tooltip text and click target
// differed. `click` emits the button element itself so a caller anchoring a dropdown menu
// (contextMenu's own openContextMenuAt) has a rect to anchor against without a second ref.
defineProps<{
  label: string;
  tooltip: string;
  hasPopup?: boolean;
}>();

const emit = defineEmits<{ click: [button: HTMLButtonElement] }>();

const btn = ref<HTMLButtonElement | null>(null);

function onClick(): void {
  if (btn.value) emit('click', btn.value);
}
</script>

<template>
  <div class="h-full flex items-center shrink-0 pr-1 pl-0.5" data-testid="tab-strip-actions">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          ref="btn"
          type="button"
          class="flex items-center justify-center size-5.5 bg-transparent border-0 cursor-pointer rounded-kira-sm text-muted-foreground hover:bg-hover hover:text-fg"
          :aria-label="label"
          :aria-haspopup="hasPopup ? 'menu' : undefined"
          data-testid="tab-strip-new"
          @click="onClick"
        >
          <CodiconIcon name="add" :size="13" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ tooltip }}</TooltipContent>
    </Tooltip>
  </div>
</template>
