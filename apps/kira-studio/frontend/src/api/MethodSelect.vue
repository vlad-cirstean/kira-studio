<script setup lang="ts">
import { HTTP_METHODS, type HttpMethod, httpMethodToken } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { nativeSelectVariants } from '@theme/components/ui/native-select';
import { cn } from '@theme/lib/utils';
import { methodTextClass } from '@theme/methodColor';

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

function select(method: unknown): void {
  emit('update:modelValue', String(method) as HttpMethod);
}
</script>

<template>
  <DropdownMenu :modal="false">
    <div class="relative flex">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :class="cn(nativeSelectVariants({ variant: 'bordered', size: 'kira' }), 'font-semibold font-data', methodTextClass(httpMethodToken(props.modelValue)))"
          :data-testid="testid"
          :data-value="props.modelValue"
        >
          <span class="method-select-label">{{ props.modelValue }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </button>
      </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent align="start" class="w-36" data-testid="method-menu">
      <DropdownMenuRadioGroup :model-value="props.modelValue" @update:model-value="select">
        <DropdownMenuRadioItem
          v-for="m in HTTP_METHODS"
          :key="m"
          :value="m"
          :class="cn('h-control font-semibold', methodTextClass(httpMethodToken(m)))"
          :data-testid="`method-menu-item-${m}`"
          :data-value="m"
        >
          {{ m }}
          <template #indicator-icon><CodiconIcon name="check" :size="13" /></template>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
