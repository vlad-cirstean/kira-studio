<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { connColorVar } from '../theme/connColor';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';
import {
  activeEnvironmentId,
  initVariables,
  openEnvironmentsDialog,
  setActiveEnvironment,
  variablesState,
} from './state/variables';

// P5 D11: the switcher — mounted in both request views' existing `#toolbar-2` slot, right-aligned
// via `.p-push` beside the request-pane SegmentedControl. The left panel's header and the title
// bar were both weighed and declined (§ D11): environments exist independently of collections, so
// the switcher must stay visible with none, and the title bar is shared chrome Api must not grow
// into.
//
// P18 D19: app-drawn now, on P17 D18's exact precedent (MethodSelect.vue) and for the identical
// reason — a native <option>'s per-row colour is `option`-level styling that lands only under
// `appearance: base-select` and only where the engine implements it, and this control now needs a
// colour dot per row (D17). The closed state stays `.p-select.bordered` either way, so its height/
// border/padding do not change at all (P16 D6's rule, api-ui-consistency.spec.ts's own guard).
onMounted(initVariables);

const open = ref(false);

const activeEnvironment = computed(
  () => variablesState.environments.find((e) => e.id === activeEnvironmentId.value) ?? null,
);

function selectNone(): void {
  open.value = false;
  void setActiveEnvironment('');
}

function selectEnvironment(id: string): void {
  open.value = false;
  void setActiveEnvironment(id);
}

function manage(): void {
  open.value = false;
  openEnvironmentsDialog();
}
</script>

<template>
  <div class="environment-anchor p-push">
    <button
      type="button"
      class="p-select bordered environment-select"
      data-testid="api-environment-select"
      :data-value="activeEnvironmentId"
      @click="open = !open"
    >
      <span
        class="p-conn-dot"
        :class="{ none: !activeEnvironment?.color || activeEnvironment.color === 'none' }"
        :style="{ '--kira-rail': connColorVar(activeEnvironment?.color) }"
      />
      <span class="environment-select-label">{{ activeEnvironment?.name ?? 'No environment' }}</span>
      <CodiconIcon name="chevron-down" :size="12" />
    </button>
    <PopoverPanel
      v-if="open"
      :width="200"
      anchor="right"
      test-id="api-environment-menu"
      backdrop-test-id="api-environment-menu-backdrop"
      @close="open = false"
    >
      <div class="environment-menu">
        <button
          type="button"
          class="p-row row environment-menu-item"
          data-testid="api-environment-option-none"
          data-value=""
          @click="selectNone"
        >
          <span class="p-conn-dot none" />
          <span class="label">No environment</span>
          <span class="icon-box">
            <CodiconIcon v-if="activeEnvironmentId === ''" name="check" :size="13" />
          </span>
        </button>
        <button
          v-for="env in variablesState.environments"
          :key="env.id"
          type="button"
          class="p-row row environment-menu-item"
          data-testid="api-environment-option"
          :data-value="env.id"
          @click="selectEnvironment(env.id)"
        >
          <span
            class="p-conn-dot"
            :class="{ none: env.color === 'none' }"
            :style="{ '--kira-rail': connColorVar(env.color) }"
          />
          <span class="label">{{ env.name }}</span>
          <span class="icon-box">
            <CodiconIcon v-if="env.id === activeEnvironmentId" name="check" :size="13" />
          </span>
        </button>
        <div class="environment-menu-separator" />
        <button
          type="button"
          class="p-row row environment-menu-item"
          data-testid="api-environment-manage"
          @click="manage"
        >
          <span class="label">Manage environments…</span>
        </button>
      </div>
    </PopoverPanel>
  </div>
</template>

<style scoped>
.environment-anchor {
  position: relative;
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
}

.environment-select {
  min-width: 0;
}

.environment-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.environment-menu {
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-1);
}

.environment-menu-item {
  width: 100%;
  border-radius: var(--kira-radius-sm);
  gap: var(--kira-s-2);
}

.environment-menu-item .label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.environment-menu-separator {
  height: var(--kira-border-width);
  background: var(--kira-border);
  margin: var(--kira-s-1) 0;
}
</style>
