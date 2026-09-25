<script setup lang="ts">
import { HTTP_METHODS, type HttpMethod, httpMethodToken } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { nativeSelectVariants } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { cn } from '@theme/lib/utils';
import { methodTextClass } from '@theme/methodColor';
import { ref } from 'vue';

// P17 D18/D19, item 1: an app-drawn menu trigger, on the exact P42 D27 precedent
// (views/shared/celleditor/CellEditorView.vue's own format-select/openFormatMenu, F12) — a native
// <select>'s per-option colour is `option`-level styling, which lands only under
// `appearance: base-select` and only where the engine implements it. The closed state is styled by
// nativeSelectVariants({variant:'bordered'}) either way (untouched by the element swap), so nothing
// about height/border/padding changes (P16 D6's own rule stays true) — only the open list gains
// reliable per-row colour.
//
// A controlled component (`modelValue`/`update:modelValue`), not the tab-state patcher itself —
// HttpRequestView.vue keeps calling patchHttpRequestTabState from its own onMethodChange, same
// division of labour AutocompleteField.vue and every other controlled primitive here already has.
const props = defineProps<{
  modelValue: HttpMethod;
  testid?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [HttpMethod] }>();

const open = ref(false);

function select(method: HttpMethod): void {
  emit('update:modelValue', method);
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open">
    <div class="relative flex">
      <PopoverTrigger as-child>
        <button
          type="button"
          :class="cn(nativeSelectVariants({ variant: 'bordered' }), 'font-semibold font-data', methodTextClass(httpMethodToken(props.modelValue)))"
          :data-testid="testid"
          :data-value="props.modelValue"
        >
          <span class="method-select-label">{{ props.modelValue }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </button>
      </PopoverTrigger>
    </div>
    <PopoverContent align="start" class="w-36 gap-0 p-0" data-testid="method-menu">
      <div class="flex flex-col p-0.5">
        <button
          v-for="m in HTTP_METHODS"
          :key="m"
          type="button"
          class="row"
          :class="
            cn(
              'h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover w-full font-semibold',
              methodTextClass(httpMethodToken(m)),
            )
          "
          :data-testid="`method-menu-item-${m}`"
          :data-value="m"
          @click="select(m)"
        >
          <span class="flex-1">{{ m }}</span>
          <span class="size-4 flex items-center justify-center shrink-0">
            <CodiconIcon v-if="m === props.modelValue" name="check" :size="13" />
          </span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
