<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
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
  const total =
    Math.round((Number.parseFloat(parsed.value.num) + Number(extendBy.value)) * 100) / 100;
  emit('save', `${total}${parsed.value.unit}`);
  extendBy.value = '';
}

const unitItems = computed(() => [
  { value: 'h', label: t('space.ade.estimate.hours.option'), testid: 'ade-estimate-unit-h' },
  { value: 'd', label: t('space.ade.estimate.days.option'), testid: 'ade-estimate-unit-d' },
]);

const hint = computed(() =>
  props.days > 1 ? t('space.ade.estimate.spans.label', { count: props.days }) : '',
);
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div v-if="locked" class="flex min-h-row items-center gap-1.5">
      <span class="text-kira-md text-fg" data-testid="ade-estimate-total">{{ est }}</span>
      <Label for="ade-estimate-extend" class="sr-only">{{
        t('space.ade.estimate.extend.aria')
      }}</Label>
      <Input
        id="ade-estimate-extend"
        v-model="extendBy"
        type="number"
        min="0.5"
        step="0.5"
        size="kira-lg"
        class="w-20"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? 'ade-estimate-error-text' : undefined"
        data-testid="ade-estimate-extend"
      />
      <span class="text-kira-sm text-muted-foreground">{{
        parsed.unit === 'd' ? t('space.ade.estimate.days.option') : t('space.ade.estimate.hours.option')
      }}</span>
      <Button
        variant="dialog"
        size="kira-lg"
        :disabled="!canExtend"
        data-testid="ade-estimate-extend-submit"
        @click="extend"
      >
        {{ t('space.ade.estimate.extend.label') }}
      </Button>
      <span class="text-kira-sm text-muted-foreground">{{ hint }}</span>
    </div>
    <div v-else class="flex min-h-row items-center gap-1.5">
      <Label for="ade-est-num" class="sr-only">{{ t('space.ade.estimate.field.label') }}</Label>
      <Input
        id="ade-est-num"
        v-model="num"
        type="number"
        min="0"
        step="0.5"
        size="kira-lg"
        class="w-20"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? 'ade-estimate-error-text' : undefined"
        data-testid="ade-estimate-num"
        @change="commit"
      />
      <!-- mousedown.prevent: a click would otherwise blur the number input first and commit with the stale unit. -->
      <SecondaryTabs
        variant="segmented"
        size="kira-lg"
        :model-value="unit"
        :items="unitItems"
        :aria-label="t('space.ade.estimate.unit.aria')"
        @mousedown.prevent
        @update:model-value="(v) => pickUnit(v === 'd' ? 'd' : 'h')"
      />
      <span class="text-kira-sm text-muted-foreground">{{ hint }}</span>
    </div>
    <FieldError v-if="error" id="ade-estimate-error-text" data-testid="ade-estimate-error">{{
      error
    }}</FieldError>
  </div>
</template>
