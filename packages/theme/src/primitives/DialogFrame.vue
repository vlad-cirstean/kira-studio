<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';

// Shared chrome for every modal dialog (ConnectionDialog, FiltersDialog, SettingsDialog):
// scrim, Escape-to-close, click-outside-to-close, a Tab focus trap, and focus-on-mount. Each
// consumer keeps its own body/footer content and — when a plain title string is not enough
// (an icon, a step indicator, a "Change engine" button) — supplies the `header` slot instead.
//
// `height` vs `maxHeight`: most dialogs size themselves to their content up to a cap
// (`maxHeight`, e.g. "80vh"); SettingsDialog's two-pane layout instead needs a constant height
// so switching sections never resizes the window (`height`, in px). Pass exactly one.
//
// P99 Part 2 (§6.2): internals moved onto reka-ui's DialogRoot/Portal/Overlay/Content — its own
// focus trap, Escape and click-outside handling replace the hand-rolled `onKeydown`/`focusable()`
// pair, on the app's own `.p-float`/--kira-shadow-dialog visual classes (not shadcn's own
// DialogContent.vue, whose rounded-xl/animation vocabulary doesn't match this design system's
// pixel-exact chrome). Public props/emit/slots unchanged, so every consumer needs zero edits.
const props = withDefaults(
  defineProps<{
    title: string;
    width?: number;
    maxHeight?: string;
    height?: number;
    testId?: string;
    closeTestId?: string;
  }>(),
  { width: 560 },
);

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <DialogRoot :open="true" @update:open="(v) => !v && emit('close')">
    <DialogPortal>
      <DialogOverlay
        class="scrim fixed inset-0 z-[var(--kira-z-dialog)] flex items-center justify-center bg-black/50"
        :data-testid="testId"
      >
        <DialogContent
          class="dialog p-float flex flex-col rounded-kira border border-border-strong bg-elevated shadow-[var(--kira-shadow-dialog)] outline-none"
          role="dialog"
          :aria-label="title"
          :style="{
            width: `${props.width}px`,
            maxHeight: props.height === undefined ? props.maxHeight : undefined,
            height: props.height !== undefined ? `${props.height}px` : undefined,
          }"
        >
          <div
            class="dialog-title h-[var(--kira-h-lg)] shrink-0 flex items-center gap-[var(--kira-s-3)] pl-[var(--kira-s-5)] pr-[var(--kira-s-4)] border-b border-border text-[length:var(--kira-t-lg)] text-fg"
          >
            <slot name="header">
              <DialogTitle as="span">{{ title }}</DialogTitle>
            </slot>
            <button
              type="button"
              class="p-iconbtn p-push ml-auto"
              aria-label="Close"
              :data-testid="closeTestId"
              @click="emit('close')"
            >
              <CodiconIcon name="close" :size="13" />
            </button>
          </div>
          <div class="dialog-body flex-1 min-h-0 overflow-auto">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="dialog-footer h-[46px] shrink-0 px-[var(--kira-s-5)] flex items-center gap-[var(--kira-s-3)] border-t border-border"
          >
            <slot name="footer" />
          </div>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
