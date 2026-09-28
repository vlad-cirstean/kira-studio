<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { computed, ref, watch } from 'vue';
import type { QueuePanel } from './useQueue';

// P129 Part 6 §0.12: the Estimate row (mockup 344-354) — a number input plus an hours/days toggle,
// writing `${num}${unit}` on `change` (not per keystroke). Switching the toggle keeps the number.
// P135 §6.1: once set, the value only grows — no editing the number or unit directly, only adding
// to it via a separate "Extend by" input that never itself writes the total.
const props = defineProps<{
  estimate: QueuePanel['estimate'];
  error: string | null;
}>();

const emit = defineEmits<{ save: [value: string] }>();

// Vue's compiler auto-casts `v-model` on a native `type="number"` input to a JS number once the
// user types (unrelated to any explicit `.number` modifier) — `num` is declared a string, but a
// live value here can be a number regardless. `String(...)` before `.trim()` is required, not
// cosmetic: without it, `num.value.trim` is undefined for any typed value, `commit` throws inside
// its own `emit(...)` argument, and the emit never happens — every estimate write silently no-ops.
const num = ref(props.estimate.num);
const unit = ref<'h' | 'd'>(props.estimate.unit);
const extendBy = ref('');

watch(
  () => props.estimate,
  (next) => {
    num.value = next.num;
    unit.value = next.unit;
    extendBy.value = '';
  },
);

const locked = computed(() => props.estimate.num !== '');

function commit(): void {
  const numStr = String(num.value).trim();
  emit('save', numStr ? `${numStr}${unit.value}` : '');
}

function pickUnit(next: 'h' | 'd'): void {
  unit.value = next;
  commit();
}

const canExtend = computed(() => Number(extendBy.value) > 0);

function extend(): void {
  if (!canExtend.value) return;
  const delta = Number(extendBy.value);
  const total = Math.round((Number.parseFloat(num.value) + delta) * 100) / 100;
  emit('save', `${total}${unit.value}`);
  extendBy.value = '';
}

const hint = computed(() => (props.estimate.days > 1 ? `spans ${props.estimate.days} days` : ''));
</script>

<template>
  <div class="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-2.5">
    <label for="ade-est-num" class="text-kira-sm text-[#9a9ca5]">Estimate</label>
    <div v-if="locked" class="flex h-7 items-center gap-1.5">
      <span class="font-data text-kira-sm text-fg" data-testid="ade-estimate-total"
        >{{ estimate.num }}{{ estimate.unit }}</span
      >
      <Input
        id="ade-estimate-extend"
        v-model="extendBy"
        type="number"
        min="0.5"
        step="0.5"
        class="h-6 w-14 font-data text-kira-sm"
        data-testid="ade-estimate-extend"
      />
      <span class="text-kira-sm text-[#9a9ca5]">{{ estimate.unit === 'd' ? 'days' : 'hours' }}</span>
      <Button
        type="button"
        size="sm"
        :disabled="!canExtend"
        data-testid="ade-estimate-extend-submit"
        @click="extend"
      >
        Extend
      </Button>
      <span class="text-kira-sm text-[#9a9ca5]">{{ hint }}</span>
    </div>
    <div v-else class="flex h-7 items-center gap-1.5">
      <Input
        id="ade-est-num"
        v-model="num"
        type="number"
        min="0"
        step="0.5"
        class="h-6 w-14 font-data text-kira-sm"
        @change="commit"
      />
      <fieldset
        aria-label="Estimate unit"
        class="m-0 flex gap-0.5 rounded-kira-sm border border-[#2f323b] bg-[#1b1d22] p-0.5"
      >
        <!-- mousedown.prevent: without it, clicking a toggle button blurs the number input first,
             firing its own @change/commit with the STALE unit, before this button's click runs. -->
        <button
          type="button"
          class="rounded px-2 py-0.5 text-kira-sm"
          :class="unit === 'h' ? 'bg-[#2f323b] text-fg' : 'text-[#9a9ca5]'"
          :aria-pressed="unit === 'h'"
          @mousedown.prevent
          @click="pickUnit('h')"
        >
          hours
        </button>
        <button
          type="button"
          class="rounded px-2 py-0.5 text-kira-sm"
          :class="unit === 'd' ? 'bg-[#2f323b] text-fg' : 'text-[#9a9ca5]'"
          :aria-pressed="unit === 'd'"
          @mousedown.prevent
          @click="pickUnit('d')"
        >
          days
        </button>
      </fieldset>
      <span class="text-kira-sm text-[#9a9ca5]">{{ hint }}</span>
    </div>
    <span v-if="error" class="col-start-2 text-kira-sm text-[#f28b7d]" data-testid="ade-estimate-error">{{
      error
    }}</span>
  </div>
</template>
