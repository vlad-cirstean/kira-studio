<script setup lang="ts">
/**
 * G19 D3b: promoted from `packages/git-ui/src/components/RowContextMenu.vue` — its ARIA `menu`/
 * `menuitem` semantics, full keyboard roving focus, and focus-capture-and-return were already
 * correct there (F3); this is a move to a shared, host-agnostic home, generalised to render an
 * icon-box per row and a `danger` variant, not a rewrite of the interaction logic itself (see
 * `contextMenuModel.ts` for the promoted keyboard-nav helpers).
 *
 * Owns no global singleton — each instance is created and destroyed by its caller, exactly as
 * `RowContextMenu.vue` already did. Submenus are explicitly not included (D3's own non-goal) —
 * nothing in `packages/git-ui`'s own menus needs one.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  enabledNeighbour,
  firstEnabled,
  flattenItems,
  type MenuSection,
} from './contextMenuModel.ts';

const props = defineProps<{
  sections: readonly MenuSection[];
  x: number;
  y: number;
  label: string;
  /** The menu's own accessible name (replacing `label` as `aria-label`) *and* a non-interactive
   *  first line inside it — e.g. a ref-badge menu titled with the branch name so it cannot be
   *  misread. Absent for a menu with no comparable ambiguity. */
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();

const rootEl = ref<HTMLDivElement | null>(null);
const menuEl = ref<HTMLDivElement | null>(null);

let invoker: HTMLElement | null = null;

const flatItems = computed(() => flattenItems(props.sections));

function itemId(id: string): string {
  return `kui-menu-item-${id}`;
}

const focusedId = ref<string | undefined>(firstEnabled(flatItems.value));

function focusItem(id: string | undefined): void {
  if (id === undefined) return;
  focusedId.value = id;
  menuEl.value?.querySelector<HTMLElement>(`#${itemId(id)}`)?.focus();
}

function neighbour(direction: 1 | -1): string | undefined {
  return enabledNeighbour(flatItems.value, focusedId.value, direction);
}

/** Every key this menu recognises calls `stopPropagation()` — most load-bearingly `Escape`: a
 *  host's own document-level `Escape` handler must never see the same keystroke this menu
 *  already acted on, or one press would close the menu *and* whatever else is listening together
 *  instead of one at a time. */
function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      emit('close');
      break;
    case 'ArrowDown':
      event.preventDefault();
      event.stopPropagation();
      focusItem(neighbour(1));
      break;
    case 'ArrowUp':
      event.preventDefault();
      event.stopPropagation();
      focusItem(neighbour(-1));
      break;
    case 'Home':
      event.preventDefault();
      event.stopPropagation();
      focusItem(enabledNeighbour(flatItems.value, undefined, 1));
      break;
    case 'End':
      event.preventDefault();
      event.stopPropagation();
      focusItem(enabledNeighbour(flatItems.value, undefined, -1));
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      event.stopPropagation();
      activate(focusedId.value);
      break;
    case 'Tab':
      // A menu does not participate in normal tab order — closing it here rather than letting
      // focus leave to whatever the page's own next tab stop happens to be.
      event.preventDefault();
      event.stopPropagation();
      emit('close');
      break;
    default:
      break;
  }
}

function activate(id: string | undefined): void {
  if (id === undefined) return;
  const item = flatItems.value.find((entry) => entry.id === id);
  if (!item || item.disabled) return;
  emit('select', id);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (rootEl.value && event.target instanceof Node && rootEl.value.contains(event.target)) return;
  emit('close');
}

/** Clamps the panel back on-screen — a right-click near the panel's own right/bottom edge must
 *  not render a menu whose own items are partly off the viewport. */
const style = ref({ left: `${props.x}px`, top: `${props.y}px` });

onMounted(() => {
  invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  focusItem(focusedId.value);
  requestAnimationFrame(() => {
    const el = menuEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width - 4);
    const maxTop = Math.max(0, window.innerHeight - rect.height - 4);
    style.value = {
      left: `${Math.min(props.x, maxLeft)}px`,
      top: `${Math.min(props.y, maxTop)}px`,
    };
  });
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  invoker?.focus();
});
</script>

<template>
  <div ref="rootEl" class="kui-menu-root-wrap">
    <div
      ref="menuEl"
      class="kui-menu-root"
      role="menu"
      :aria-label="title ?? label"
      :style="style"
      @keydown="onKeydown"
    >
      <div v-if="title" class="kui-menu-heading" aria-hidden="true">{{ title }}</div>
      <template v-for="(section, sectionIndex) in sections" :key="sectionIndex">
        <div v-if="sectionIndex > 0" class="kui-menu-separator" role="separator"></div>
        <div
          v-for="item in section.items"
          :id="itemId(item.id)"
          :key="item.id"
          class="kui-menu-item"
          :class="{ 'kui-menu-item--disabled': item.disabled, 'kui-menu-item--danger': item.danger }"
          role="menuitem"
          :aria-disabled="item.disabled"
          :aria-describedby="item.disabled && item.disabledReason ? `${itemId(item.id)}-reason` : undefined"
          :tabindex="focusedId === item.id ? 0 : -1"
          @click="activate(item.id)"
          @mouseenter="focusedId = item.id"
        >
          <span v-if="item.icon" class="kui-icon-box">
            <span class="codicon" :class="item.icon" aria-hidden="true"></span>
          </span>
          <span>{{ item.label }}</span>
          <span
            v-if="item.disabled && item.disabledReason"
            :id="`${itemId(item.id)}-reason`"
            class="kui-visually-hidden"
          >
            {{ item.disabledReason }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
