<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { nativeSelectVariants } from '@theme/components/ui/native-select';
import { connColorVar } from '@theme/connColor';
import { computed } from 'vue';
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

// reka radio values cannot be '' — "No environment" travels as this sentinel.
const NONE = '__none__';
const radioValue = computed(() => (activeEnvironmentId.value === '' ? NONE : activeEnvironmentId.value));

const activeEnvironmentId = computed(() => variablesStore.environmentIdForTab(props.tabId));
const activeEnvironment = computed(
  () => variablesStore.environments.find((e) => e.id === activeEnvironmentId.value) ?? null,
);

function onSelect(value: unknown): void {
  const id = String(value);
  void variablesStore.selectEnvironmentForTab(props.tabId, id === NONE ? '' : id);
}

function manage(): void {
  variablesStore.openEnvironments();
}
</script>

<template>
  <DropdownMenu :modal="false">
    <div class="relative flex min-w-0 flex-initial ml-auto">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :class="[nativeSelectVariants({ variant: 'bordered' }), 'min-w-0']"
          data-testid="api-environment-select"
          :data-value="activeEnvironmentId"
        >
          <span
            class="size-1.25 rounded-full shrink-0"
            :class="(!activeEnvironment?.color || activeEnvironment.color === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
            data-testid="conn-dot"
            :style="{ '--kira-rail': connColorVar(activeEnvironment?.color) }"
          />
          <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ activeEnvironment?.name ?? 'No environment' }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </button>
      </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent align="end" class="w-52" data-testid="api-environment-menu">
      <DropdownMenuRadioGroup :model-value="radioValue" @update:model-value="onSelect">
        <DropdownMenuRadioItem
          :value="NONE"
          class="h-control"
          data-testid="api-environment-option-none"
          data-value=""
        >
          <span class="size-1.25 rounded-full shrink-0 bg-none border border-disabled" data-testid="conn-dot" />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">No environment</span>
          <template #indicator-icon><CodiconIcon name="check" :size="13" /></template>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          v-for="env in variablesStore.environments"
          :key="env.id"
          :value="env.id"
          class="h-control"
          data-testid="api-environment-option"
          :data-value="env.id"
        >
          <span
            class="size-1.25 rounded-full shrink-0"
            :class="env.color === 'none' ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
            data-testid="conn-dot"
            :style="{ '--kira-rail': connColorVar(env.color) }"
          />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ env.name }}</span>
          <template #indicator-icon><CodiconIcon name="check" :size="13" /></template>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="h-control" data-testid="api-environment-manage" @select="manage">
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">Manage environments…</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
