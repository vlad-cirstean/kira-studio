<script setup lang="ts">
import { HTTP_METHODS, type HttpMethod, httpMethodToken } from '@shared/domain/http';
import { ref } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';

// P17 D18/D19, item 1: an app-drawn menu trigger, on the exact P42 D27 precedent
// (views/shared/celleditor/CellEditorView.vue's own format-select/openFormatMenu, F12) — a native
// <select>'s per-option colour is `option`-level styling, which lands only under
// `appearance: base-select` and only where the engine implements it (primitives.css:382's own
// comment). The closed state is plain CSS either way (`.p-select.bordered`, untouched by the
// element swap), so nothing about height/border/padding changes (P16 D6's own rule stays true) —
// only the open list gains reliable per-row colour.
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
  <div class="method-anchor">
    <button
      type="button"
      class="p-select bordered method-select p-method"
      :class="httpMethodToken(props.modelValue)"
      :data-testid="testid"
      :data-value="props.modelValue"
      @click="open = !open"
    >
      <span class="method-select-label">{{ props.modelValue }}</span>
      <CodiconIcon name="chevron-down" :size="12" />
    </button>
    <PopoverPanel
      v-if="open"
      :width="140"
      anchor="left"
      test-id="method-menu"
      backdrop-test-id="method-menu-backdrop"
      @close="open = false"
    >
      <div class="method-menu">
        <button
          v-for="m in HTTP_METHODS"
          :key="m"
          type="button"
          class="p-row row method-menu-item p-method"
          :class="httpMethodToken(m)"
          :data-testid="`method-menu-item-${m}`"
          :data-value="m"
          @click="select(m)"
        >
          <span class="label">{{ m }}</span>
          <span class="icon-box">
            <CodiconIcon v-if="m === props.modelValue" name="check" :size="13" />
          </span>
        </button>
      </div>
    </PopoverPanel>
  </div>
</template>

<style scoped>
.method-anchor {
  position: relative;
  display: flex;
}

/* F12's own comment, restated: border/background/padding/cursor come from .p-select.bordered
   (unaffected by the element swap); the chevron is drawn explicitly since a <button> has no
   ::picker-icon of its own to rely on. */
.method-select {
  font-family: var(--kira-font-family);
  font-weight: 600;
}

.method-menu {
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-1);
}

.method-menu-item {
  width: 100%;
  font-weight: 600;
  border-radius: var(--kira-radius-sm);
}

.method-menu-item .label {
  flex: 1;
}

/* .p-method's own tinted background beats .p-row:hover's plain one at equal specificity (defined
   later in the cascade) — brightness is an independent property, so this still gives hover
   feedback without fighting that rule. */
.method-menu-item:hover {
  filter: brightness(1.2);
}
</style>
