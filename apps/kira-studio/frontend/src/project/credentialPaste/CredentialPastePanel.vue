<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import { useDebounceFn, useTimeoutFn } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { type PasteCandidate, type PasteField, type PasteResult, parseCredentialPaste } from './parse';

// The pasted text lives only in this component's refs: never in a store, localStorage, the op log
// or the console. Clearing drops the references (JS strings are immutable, so memory is not zeroed).
// `retain`: keep the text after Apply, for a caller whose apply can fail and be retried; the
// caller then closes the panel, which clears it on unmount.
const props = defineProps<{ kind: ConnectionKind; allowed: readonly PasteField[]; retain?: boolean }>();
const emit = defineEmits<{
  apply: [values: Partial<Record<PasteField, string>>];
  cancel: [];
}>();

const FIELD_LABEL: Record<PasteField, string> = {
  host: 'Host',
  port: 'Port',
  database: 'Database',
  username: 'User',
  password: 'Password',
  region: 'Region',
  profile: 'AWS profile',
  authSource: 'Auth source',
};

const text = ref('');
const showText = ref(false);
const showPassword = ref(false);
const result = ref<PasteResult | null>(null);
const picks = ref<Partial<Record<PasteField, number>>>({});
const input = useTemplateRef<{ $el: HTMLTextAreaElement }>('input');

function parseNow(): void {
  result.value = text.value === '' ? null : parseCredentialPaste(text.value, props.kind);
  picks.value = {};
}
const parseDebounced = useDebounceFn(parseNow, 150);
// The paste event fires before the textarea value updates; parse on the next task.
const { start: parseAfterPaste } = useTimeoutFn(parseNow, 0, { immediate: false });

function reset(): void {
  text.value = '';
  result.value = null;
  picks.value = {};
  showText.value = false;
  showPassword.value = false;
}

onMounted(() => input.value?.$el.focus());
onBeforeUnmount(reset);

interface Row {
  field: PasteField;
  candidates: PasteCandidate[];
}

const rows = computed<Row[]>(() => {
  const fields = result.value?.fields ?? {};
  return props.allowed.flatMap((field) => {
    const candidates = fields[field];
    return candidates && candidates.length > 0 ? [{ field, candidates }] : [];
  });
});
const alsoFound = computed(() => {
  const fields = result.value?.fields ?? {};
  return (Object.keys(fields) as PasteField[])
    .filter((f) => !props.allowed.includes(f))
    .map((f) => FIELD_LABEL[f].toLowerCase());
});

function chosen(row: Row): PasteCandidate {
  return row.candidates[picks.value[row.field] ?? 0] ?? row.candidates[0];
}
function shown(field: PasteField, c: PasteCandidate): string {
  return field === 'password' && !showPassword.value ? '•'.repeat(8) : c.value;
}

function onApply(): void {
  const values: Partial<Record<PasteField, string>> = {};
  for (const row of rows.value) values[row.field] = chosen(row).value;
  if (!props.retain) reset();
  emit('apply', values);
}
function onCancel(): void {
  reset();
  emit('cancel');
}
</script>

<template>
  <div class="flex flex-col gap-2 text-kira-md" data-testid="paste-credentials-panel">
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-1">
        <Label class="leading-none text-muted-foreground">Paste credentials</Label>
        <TooltipIconButton
          :icon="showText ? 'eye-closed' : 'eye'"
          :label="showText ? 'Hide text' : 'Show text'"
          data-testid="paste-credentials-toggle-text"
          @click="showText = !showText"
        />
      </div>
      <Textarea
        ref="input"
        v-model="text"
        :class="['font-data h-24 resize-none', showText ? '' : '[-webkit-text-security:disc]']"
        placeholder="user: …  password: …&#10;PGPASSWORD=…&#10;mysql -u … -p…"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-testid="paste-credentials-input"
        @paste="parseAfterPaste()"
        @update:model-value="parseDebounced()"
      />
    </div>

    <Alert v-if="result?.tooLong" variant="warn" data-testid="paste-credentials-too-long">
      <AlertDescription>Too long to be credentials.</AlertDescription>
    </Alert>

    <div v-if="rows.length > 0" class="flex flex-col gap-1">
      <div
        v-for="row in rows"
        :key="row.field"
        class="flex items-center gap-2"
        :data-testid="`paste-credentials-row-${row.field}`"
      >
        <span class="w-20 shrink-0 text-muted-foreground">{{ FIELD_LABEL[row.field] }}</span>
        <NativeSelect
          v-if="row.candidates.length > 1"
          :model-value="picks[row.field] ?? 0"
          class="min-w-0 flex-1 font-data"
          :data-testid="`paste-credentials-pick-${row.field}`"
          @update:model-value="(v) => (picks[row.field] = Number(v))"
        >
          <option v-for="(c, i) in row.candidates" :key="i" :value="i">{{ shown(row.field, c) }} ({{ c.label }})</option>
        </NativeSelect>
        <template v-else>
          <span class="min-w-0 flex-1 truncate font-data">{{ shown(row.field, chosen(row)) }}</span>
          <span class="shrink-0 text-kira-sm text-muted-foreground">{{ chosen(row).label }}</span>
        </template>
        <Badge v-if="chosen(row).guessed" variant="warn">guessed</Badge>
        <TooltipIconButton
          v-if="row.field === 'password'"
          :icon="showPassword ? 'eye-closed' : 'eye'"
          :label="showPassword ? 'Hide password' : 'Show password'"
          data-testid="paste-credentials-toggle-password"
          @click="showPassword = !showPassword"
        />
      </div>
    </div>
    <p v-else-if="result && !result.tooLong" class="m-0 text-muted-foreground" data-testid="paste-credentials-empty">
      Nothing recognised.
    </p>

    <p v-if="alsoFound.length > 0" class="m-0 text-kira-sm text-muted-foreground" data-testid="paste-credentials-also-found">
      Also found: {{ alsoFound.join(', ') }}. Use Edit… to change them.
    </p>
    <div
      v-if="result && (result.notes.length > 0 || result.unrecognised > 0)"
      class="flex flex-col gap-0.5 text-kira-sm text-muted-foreground"
      data-testid="paste-credentials-notes"
    >
      <span v-for="(n, i) in result.notes" :key="i">{{ n.label }}: {{ n.reason }}</span>
      <span v-if="result.unrecognised > 0">
        {{ result.unrecognised }} {{ result.unrecognised === 1 ? 'line' : 'lines' }} not recognised.
      </span>
    </div>

    <div class="flex justify-end gap-1">
      <Button variant="dialog" size="kira-lg" data-testid="paste-credentials-cancel" @click="onCancel">Cancel</Button>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="rows.length === 0"
        data-testid="paste-credentials-apply"
        @click="onApply"
      >
        Apply
      </Button>
    </div>
  </div>
</template>
