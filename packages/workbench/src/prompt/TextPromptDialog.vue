<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { useEventListener } from '@vueuse/core';
import { nextTick, onMounted, ref, useTemplateRef } from 'vue';

// P107 T2-19: deliberately NOT built on shadcn-vue's Dialog (declined, real requirement) — its
// DialogContent wraps reka-ui's DialogPortal, which teleports to document.body. Two of this
// composable's three original call sites (FilterHistoryMenu.vue, ConsoleSavedMenu.vue) raise this
// prompt from inside a reka-ui Popover's own #footer slot; both carry a test-caught fix (P104,
// data-view.spec.ts/console.spec.ts) requiring the prompt stay a DOM descendant of that
// PopoverContent — a teleported node reads as an outside interaction to Popover's own dismiss
// layer and closes the menu before the prompt is seen. A plain, non-portaled `<div v-if>` (this
// file) is the one shape that works unchanged at both a popover-nested and a directly-raised
// (GitPanel.vue) call site.
defineProps<{ title: string; modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: []; cancel: [] }>();

// ui/input's root IS the <input> element itself — no querySelector needed. onMounted fires each
// time this component is created, i.e. exactly when the caller's prompt state goes non-null.
const inputRef = ref<{ $el: HTMLInputElement } | null>(null);
onMounted(() => {
  void nextTick(() => inputRef.value?.$el.focus());
});

// P105 §5.2(b): the scrim is a pointer-event shield, not an interactive element — it absorbs a
// click so it never reaches the ancestor Popover's own outside-click dismiss layer (see the
// comment above). Not "click outside closes" (there is no close-on-backdrop behaviour here), so
// this is a plain listener move, not an onClickOutside swap.
const scrimEl = useTemplateRef<HTMLElement>('scrimEl');
useEventListener(scrimEl, 'click', (e) => e.stopPropagation());
</script>

<template>
  <div ref="scrimEl" class="text-prompt-scrim" data-testid="text-prompt">
    <div class="text-prompt-box p-float">
      <div class="text-prompt-title text-kira-sm text-muted-foreground">{{ title }}</div>
      <Input
        ref="inputRef"
        :model-value="modelValue"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2"
        data-testid="text-prompt-input"
        @update:model-value="emit('update:modelValue', String($event))"
        @keydown="wrapSelectionOnType"
        @keydown.enter="emit('submit')"
        @keydown.escape="emit('cancel')"
      />
      <div class="text-prompt-actions">
        <Button variant="dialog" size="kira-lg" data-testid="text-prompt-cancel" @click="emit('cancel')"
          >Cancel</Button
        >
        <Button variant="dialog-primary" size="kira-lg" data-testid="text-prompt-ok" @click="emit('submit')"
          >OK</Button
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.text-prompt-scrim {
  @apply fixed inset-0 flex items-center justify-center bg-black/50;
  /* P28 D17(c)'s own dialog rung, not a bare z-30 — strictly higher, so unifying every call site
     on it (including GitPanel.vue, raised directly from the panel with no popover backdrop of its
     own to clear) is a safe superset, never a visible change at any of the three. */
  z-index: var(--kira-z-dialog);
}

.text-prompt-box {
  @apply w-72 flex flex-col gap-1.5 p-2;
}

.text-prompt-actions {
  @apply flex justify-end gap-1.5;
}
</style>
