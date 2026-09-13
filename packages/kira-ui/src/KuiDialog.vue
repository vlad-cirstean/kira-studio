<script setup lang="ts">
/**
 * G21 D2: the modal shell `packages/git-ui`'s eleven hand-rolled dialogs each redeclared —
 * `kv-modal-backdrop`/`kv-modal`/`kv-modal-title`/`kv-modal-actions`/`kv-modal-button*`, some of
 * it duplicated verbatim across four files (F2(a)). One implementation: a teleported, full-
 * viewport backdrop (`--kui-z-modal`, a new rung above `--kui-z-popover` — every dialog sits
 * above any dropdown a page underneath it may have left open), a `role="dialog" aria-modal="true"`
 * panel, Escape-to-close, click-outside-closes, and the focus trap/return moved verbatim from
 * `packages/git-ui/src/components/dialogs/modalFocus.ts` (`./modalFocus.ts` in this package).
 *
 * `title` is both a prop and a slot: the prop covers every dialog whose heading is plain text
 * (the common case), and the `title` slot's fallback content is the prop itself — so a dialog
 * whose heading embeds markup (`ResetDialog.vue`'s "Move `<code>main</code>` to `<code>a1b2c3d</code>`")
 * overrides it with a `<template #title>` block instead of stringifying markup into a prop.
 *
 * `labelledBy` overrides the auto-generated heading id for a caller that needs a stable/known id;
 * every other caller lets `useId()` mint one and never touches the attribute directly.
 */
import { computed, ref, useId } from 'vue';
import { useModalFocus } from './modalFocus.ts';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    labelledBy?: string;
    width?: number;
  }>(),
  { width: 480 },
);

const emit = defineEmits<{ close: [] }>();

const rootEl = ref<HTMLDivElement | null>(null);
const active = computed(() => props.open);
const { onKeydown } = useModalFocus(active, rootEl);

const generatedId = useId();
const titleId = computed(() => props.labelledBy ?? generatedId);

function close(): void {
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="kui-modal-backdrop" @click.self="close">
      <div
        ref="rootEl"
        class="kui-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :style="{ width: `min(${width}px, 90vw)` }"
        @keydown="onKeydown"
        @keydown.escape="close"
      >
        <h2 :id="titleId" class="kui-modal-title">
          <slot name="title">{{ title }}</slot>
        </h2>
        <div class="kui-modal-body">
          <slot />
        </div>
        <div v-if="$slots.actions" class="kui-modal-actions">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
