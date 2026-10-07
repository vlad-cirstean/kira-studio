<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { computed, ref, watch } from 'vue';

// Estimate row. Unset: number plus an hours/days toggle, written on `change`. Set: extend-only
// (D16), so only an "Extend" input adds to the total and the backend refuses a shrink.
const props = defineProps<{
  /** `Task.est`: `''` none, else `<n>h` / `<n>d`. */
  est: string;
  /** Days the task spans on the plan. */
  days: number;
  error: string | null;
}>();

const emit = defineEmits<{ save: [value: string] }>();

function split(est: string): { num: string; unit: 'h' | 'd' } {
  const m = est.trim().match(/^(\d+(?:\.\d+)?)\s*([hd])$/);
  return m ? { num: m[1] as string, unit: m[2] as 'h' | 'd' } : { num: '', unit: 'h' };
}

const parsed = computed(() => split(props.est));
const num = ref(parsed.value.num);
const unit = ref<'h' | 'd'>(parsed.value.unit);
const extendBy = ref('');

watch(parsed, (next) => {
  num.value = next.num;
  unit.value = next.unit;
  extendBy.value = '';
});

const MAX_EST = { h: 480, d: 60 };
// An estimate stored above the cap unlocks so a typo can be replaced.
const locked = computed(
  () => props.est !== '' && !(Number.parseFloat(parsed.value.num) > MAX_EST[parsed.value.unit]),
);

function commit(): void {
  const numStr = String(num.value).trim();
  emit('save', numStr ? `${numStr}${unit.value}` : '');
}

function pickUnit(next: 'h' | 'd'): void {
  unit.value = next;
  if (String(num.value).trim()) commit();
}

const canExtend = computed(() => Number(extendBy.value) > 0);

function extend(): void {
  if (!canExtend.value) return;
  const total = Math.round((Number.parseFloat(parsed.value.num) + Number(extendBy.value)) * 100) / 100;
  emit('save', `${total}${parsed.value.unit}`);
  extendBy.value = '';
}

const hint = computed(() => (props.days > 1 ? `spans ${props.days} days` : ''));
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div v-if="locked" class="flex h-7 items-center gap-1.5">
      <span class="font-data text-kira-md text-fg" data-testid="ade-estimate-total">{{ est }}</span>
      <label for="ade-estimate-extend" class="sr-only">Extend estimate</label>
      <Input
        id="ade-estimate-extend"
        v-model="extendBy"
        type="number"
        min="0.5"
        step="0.5"
        class="w-14 font-data"
        data-testid="ade-estimate-extend"
      />
      <span class="text-kira-sm text-muted-foreground">{{ parsed.unit === 'd' ? 'days' : 'hours' }}</span>
      <Button
        type="button"
        variant="dialog"
        size="xs"
        :disabled="!canExtend"
        data-testid="ade-estimate-extend-submit"
        @click="extend"
      >
        Extend
      </Button>
      <span class="text-kira-sm text-muted-foreground">{{ hint }}</span>
    </div>
    <div v-else class="flex h-7 items-center gap-1.5">
      <label for="ade-est-num" class="sr-only">Estimate</label>
      <Input
        id="ade-est-num"
        v-model="num"
        type="number"
        min="0"
        step="0.5"
        class="w-14 font-data"
        data-testid="ade-estimate-num"
        @change="commit"
      />
      <fieldset
        aria-label="Estimate unit"
        class="m-0 flex gap-0.5 rounded-kira-sm border border-border-strong bg-elevated p-0.5"
      >
        <!-- mousedown.prevent: a click would otherwise blur the number input first and commit with the stale unit. -->
        <button
          type="button"
          class="rounded px-2 py-0.5 text-kira-sm"
          :class="unit === 'h' ? 'bg-field text-fg' : 'text-muted-foreground'"
          :aria-pressed="unit === 'h'"
          @mousedown.prevent
          @click="pickUnit('h')"
        >
          hours
        </button>
        <button
          type="button"
          class="rounded px-2 py-0.5 text-kira-sm"
          :class="unit === 'd' ? 'bg-field text-fg' : 'text-muted-foreground'"
          :aria-pressed="unit === 'd'"
          @mousedown.prevent
          @click="pickUnit('d')"
        >
          days
        </button>
      </fieldset>
      <span class="text-kira-sm text-muted-foreground">{{ hint }}</span>
    </div>
    <span v-if="error" class="text-kira-sm text-error" data-testid="ade-estimate-error">{{ error }}</span>
  </div>
</template>
