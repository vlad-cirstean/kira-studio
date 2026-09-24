<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { nativeSelectVariants } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { connColorVar } from '@theme/connColor';
import { computed, ref } from 'vue';
import { useVariablesStore } from './state/variables';

const variablesStore = useVariablesStore();

// P5 D11: the switcher — mounted in both request views' existing `#toolbar-2` slot, right-aligned
// via `.ml-auto` beside the request-pane SegmentedControl. The left panel's header and the title
// bar were both weighed and declined (§ D11): environments exist independently of collections, so
// the switcher must stay visible with none, and the title bar is shared chrome Api must not grow
// into.
//
// Real-interaction fix (reported bug — the dropdown rendered right-aligned): its own popover used
// to request `anchor="left"` ('bottom-start', its left edge flush with the trigger's own left
// edge) despite this trigger sitting flush against its toolbar's own right edge (`.ml-auto` above)
// — a 200px popover extending rightward from there almost always has nowhere to go, so
// PopoverPanel's own shift() middleware silently clamped it back against the *viewport's* right
// edge instead, not this trigger's. Confirmed empirically (Playwright, a 1440px window): the
// popover's right edge landed within 4px of the viewport edge, not this trigger's right edge —
// coincidentally close at that width, but unrelated to the trigger's own position, and only
// getting less related the wider the window. `anchor="right"` ('bottom-end') is what every other
// right-edge-toolbar trigger in this app already uses correctly (ColumnsMenu.vue,
// ProjectionMenu.vue, PreviewCommandPanel.vue) — this was the one outlier, and gets a popover
// that is actually, reliably anchored to *this* control at every window width, not to the window.
//
// P18 D19: app-drawn now, on P17 D18's exact precedent (MethodSelect.vue) and for the identical
// reason — a native <option>'s per-row colour is `option`-level styling that lands only under
// `appearance: base-select` and only where the engine implements it, and this control now needs a
// colour dot per row (D17). The closed state stays styled by nativeSelectVariants({variant:
// 'bordered'}) either way, so its height/border/padding do not change at all (P16 D6's rule,
// api-ui-consistency.spec.ts's own guard).
//
// P112: no onMounted fetch left here — useVariablesStore's own app-lifetime query observer fetches
// the environments list on store creation.

// P71 §3.3: an optional tabId — present from both request views, so their own selection can be an
// incognito tab's own in-memory override instead of the app-wide active environment.
// environmentIdForTab/selectEnvironmentForTab already fall back to the app-wide behaviour for a
// tab that isn't incognito, and `isIncognito('')` is false for the empty-string default below (no
// tab is ever named ''), so a caller with no tab context at all needs no separate branch here — it
// gets exactly today's global behaviour for free.
const props = withDefaults(defineProps<{ tabId?: string }>(), { tabId: '' });

const open = ref(false);

const activeEnvironmentId = computed(() => variablesStore.environmentIdForTab(props.tabId));
const activeEnvironment = computed(
  () => variablesStore.environments.find((e) => e.id === activeEnvironmentId.value) ?? null,
);

function selectNone(): void {
  open.value = false;
  void variablesStore.selectEnvironmentForTab(props.tabId, '');
}

function selectEnvironment(id: string): void {
  open.value = false;
  void variablesStore.selectEnvironmentForTab(props.tabId, id);
}

function manage(): void {
  open.value = false;
  variablesStore.openEnvironments();
}
</script>

<template>
  <Popover v-model:open="open">
    <div class="environment-anchor ml-auto">
      <PopoverTrigger as-child>
        <button
          type="button"
          :class="[nativeSelectVariants({ variant: 'bordered' }), 'environment-select']"
          data-testid="api-environment-select"
          :data-value="activeEnvironmentId"
        >
          <span
            class="size-1.25 rounded-full shrink-0"
            :class="(!activeEnvironment?.color || activeEnvironment.color === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
            data-testid="conn-dot"
            :style="{ '--kira-rail': connColorVar(activeEnvironment?.color) }"
          />
          <span class="environment-select-label">{{ activeEnvironment?.name ?? 'No environment' }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </button>
      </PopoverTrigger>
    </div>
    <PopoverContent
      align="end"
      class="w-52 gap-0 p-0"
      data-testid="api-environment-menu"
    >
      <div class="environment-menu">
        <button
          type="button"
          class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover row environment-menu-item"
          data-testid="api-environment-option-none"
          data-value=""
          @click="selectNone"
        >
          <span class="size-1.25 rounded-full shrink-0 bg-none border border-disabled" data-testid="conn-dot" />
          <span class="label">No environment</span>
          <span class="size-4 flex items-center justify-center shrink-0">
            <CodiconIcon v-if="activeEnvironmentId === ''" name="check" :size="13" />
          </span>
        </button>
        <button
          v-for="env in variablesStore.environments"
          :key="env.id"
          type="button"
          class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover row environment-menu-item"
          data-testid="api-environment-option"
          :data-value="env.id"
          @click="selectEnvironment(env.id)"
        >
          <span
            class="size-1.25 rounded-full shrink-0"
            :class="env.color === 'none' ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
            data-testid="conn-dot"
            :style="{ '--kira-rail': connColorVar(env.color) }"
          />
          <span class="label">{{ env.name }}</span>
          <span class="size-4 flex items-center justify-center shrink-0">
            <CodiconIcon v-if="env.id === activeEnvironmentId" name="check" :size="13" />
          </span>
        </button>
        <div class="environment-menu-separator" />
        <button
          type="button"
          class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover row environment-menu-item"
          data-testid="api-environment-manage"
          @click="manage"
        >
          <span class="label">Manage environments…</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
@reference "@theme/base.css";

.environment-anchor {
  @apply relative flex min-w-0 flex-initial;
}

.environment-select {
  @apply min-w-0;
}

.environment-select-label {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.environment-menu {
  @apply flex flex-col p-0.5;
}

.environment-menu-item {
  @apply w-full gap-1 rounded-kira-sm;
}

.environment-menu-item .label {
  @apply flex-1 overflow-hidden text-ellipsis whitespace-nowrap;
}

.environment-menu-separator {
  @apply my-0.5 border-t border-border;
}
</style>
