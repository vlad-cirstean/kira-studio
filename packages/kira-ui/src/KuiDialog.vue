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
 *
 * P110 A6: controls.css's `.kui-modal-backdrop`/`.kui-modal`/`-title`/`-body`/`-actions` replaced
 * by `kv:` utilities. `kv:z-[var(--kui-z-modal,50)]` stays an arbitrary value (§1.1 rung 4): it
 * reads a raw `--kui-*` custom property with its own fallback, not a value on any Tailwind scale,
 * and isn't reused by `KuiTooltip`/`KuiPopoverPanel`/`KuiContextMenu`'s own distinct classes.
 * `kv:max-h-[85vh]` is a one-off literal with no scale step close enough.
 * P110 I2-28: the title's `1.05em` (relative to the inherited ~12px body size) lands 0.4px from
 * `--kv-t-lg` (13px) -- closer than the earlier "no scale step close enough" claim accounted for
 * -- so it is `kv:text-lg` now, not an arbitrary value.
 */
import { onClickOutside } from '@vueuse/core';
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

// P105 §5.2(b): the backdrop itself has no interactive role — closing on a backdrop click is the
// panel's own outside-click dismissal (VueUse), not a click handler on the backdrop div.
onClickOutside(rootEl, close);

// F4: P105's own aria-hidden="true" here (§5.2(b)) sat on this backdrop div, but that div is the
// role="dialog" panel's ancestor, not a sibling -- aria-hidden on an ancestor hides the whole
// subtree from assistive tech, the dialog included. No replacement attribute: the backdrop itself
// renders nothing accessibility-relevant.
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="kv:fixed kv:inset-0 kv:z-[var(--kui-z-modal,50)] kv:flex kv:items-center kv:justify-center kv:bg-kui-overlay"
    >
      <div
        ref="rootEl"
        class="kv:flex kv:flex-col kv:max-h-[85vh] kv:p-3 kv:bg-kui-bg-panel kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui-float kv:shadow-kui-float"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :style="{ width: `min(${width}px, 90vw)` }"
        @keydown="onKeydown"
        @keydown.escape="close"
      >
        <h2
          :id="titleId"
          class="kv:shrink-0 kv:m-0 kv:mb-2 kv:text-lg"
        >
          <slot name="title">{{ title }}</slot>
        </h2>
        <div class="kv:overflow-y-auto kv:min-h-0">
          <slot />
        </div>
        <div
          v-if="$slots.actions"
          class="kv:flex kv:shrink-0 kv:justify-end kv:gap-1 kv:mt-3"
        >
          <slot name="actions" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
