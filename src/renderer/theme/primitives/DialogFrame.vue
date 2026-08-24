<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import CodiconIcon from '../CodiconIcon.vue';

// Shared chrome for every modal dialog (ConnectionDialog, FiltersDialog, SettingsDialog):
// scrim, Escape-to-close, click-outside-to-close, a Tab focus trap, and focus-on-mount. Each
// consumer keeps its own body/footer content and — when a plain title string is not enough
// (an icon, a step indicator, a "Change engine" button) — supplies the `header` slot instead.
//
// `height` vs `maxHeight`: most dialogs size themselves to their content up to a cap
// (`maxHeight`, e.g. "80vh"); SettingsDialog's two-pane layout instead needs a constant height
// so switching sections never resizes the window (`height`, in px). Pass exactly one.
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

const dialogRef = ref<HTMLElement | null>(null);

function focusable(): HTMLElement[] {
  if (!dialogRef.value) return [];
  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled'));
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    emit('close');
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusable();
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  dialogRef.value?.focus();
});
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="scrim" :data-testid="testId" @click.self="emit('close')">
      <div
        ref="dialogRef"
        class="dialog p-float"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        :style="{
          width: `${props.width}px`,
          maxHeight: props.height === undefined ? props.maxHeight : undefined,
          height: props.height !== undefined ? `${props.height}px` : undefined,
        }"
      >
        <div class="dialog-title">
          <slot name="header"><span>{{ title }}</span></slot>
          <button
            type="button"
            class="p-iconbtn p-push"
            aria-label="Close"
            :data-testid="closeTestId"
            @click="emit('close')"
          >
            <CodiconIcon name="close" :size="14" />
          </button>
        </div>
        <div class="dialog-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="dialog-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  display: flex;
  flex-direction: column;
}

.dialog-title {
  height: var(--kira-h-lg);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4) 0 var(--kira-s-5);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: var(--kira-t-lg);
  color: var(--kira-fg);
}

.dialog-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.dialog-footer {
  height: 46px;
  flex-shrink: 0;
  padding: 0 var(--kira-s-5);
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
