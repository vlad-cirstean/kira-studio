<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import DateTimePicker from './DateTimePicker.vue';
import type { CellFormat } from './formats';
import {
  defaultShapeFor,
  describeTimestamp,
  encodeTimestamp,
  fromEditableText,
  parseTimestamp,
  toEditableText,
} from './timestamp';

// P24 D14/D15/D19: the translate pane for the three timestamp formats — the sibling of the
// hex/base64 decoded pane (CellEditorView.vue hosts both under the same head/body/staging
// shape). Bidirectional and live: every keystroke here re-encodes into `doc`, and every change to
// `doc` (hand-typed in the main editor, Reset, a fresh cell) re-renders this pane — never a
// one-shot commit. Stages nothing itself; staging is `.editor-body`'s existing focusout/
// Ctrl+Enter rule, which this pane inherits by living inside it.
const props = defineProps<{ doc: string; format: CellFormat; readOnly: boolean }>();
const emit = defineEmits<{ 'update:doc': [string] }>();

const zone = ref<'local' | 'utc'>('local');
const ZONE_OPTIONS = [
  { value: 'local' as const, label: 'Local', testid: 'cell-editor-timestamp-zone-local' },
  { value: 'utc' as const, label: 'UTC', testid: 'cell-editor-timestamp-zone-utc' },
];

const parsed = computed(() => parseTimestamp(props.format, props.doc));
const reading = computed(() => describeTimestamp(props.format, props.doc));

function shapeOrDefault() {
  return (
    parsed.value?.shape ??
    defaultShapeFor(props.format as 'epochSeconds' | 'epochMillis' | 'iso8601')
  );
}

// The editable field's own text — a plain ref, not a computed off `doc`, so a keystroke that
// doesn't yet parse (mid-typing "2024-01-1") is never clobbered before the user finishes it.
// Re-synced from `doc`/`zone` whenever either changes from *outside* this field (the encoded pane,
// Reset, a fresh cell, the zone switch) — and only when the recomputed text actually differs, so
// a round-tripped edit (parse this field's own text -> encode -> doc -> reparse -> re-render)
// never touches the ref, and so never disturbs the caret, when it lands back on the same text.
const fieldText = ref('');
function syncFieldFromDoc(): void {
  const p = parsed.value;
  const next = p ? toEditableText(p.date, zone.value, p.shape.fractionDigits) : '';
  if (next !== fieldText.value) fieldText.value = next;
}
watch(() => [props.doc, props.format] as const, syncFieldFromDoc, { immediate: true });
watch(zone, syncFieldFromDoc);

function onFieldInput(text: string): void {
  fieldText.value = text;
  const date = fromEditableText(text, zone.value);
  if (!date) return; // incomplete/invalid mid-typing — wait for more input, emit nothing (D15)
  emit('update:doc', encodeTimestamp(shapeOrDefault(), date));
}

function onPick(date: Date): void {
  emit('update:doc', encodeTimestamp(shapeOrDefault(), date));
}

const calendarOpen = ref(false);
const pickerDate = computed(() => parsed.value?.date ?? new Date());
</script>

<template>
  <div class="ts-pane" data-testid="cell-editor-timestamp-pane">
    <div class="ts-readings p-strip note" data-testid="cell-editor-timestamp">
      <CodiconIcon name="clock" :size="13" />
      <template v-if="reading">
        <span
          class="ts-reading"
          :class="{ dim: zone !== 'local' }"
          data-testid="cell-editor-timestamp-local"
          >{{ reading.local }}</span
        >
        <span class="ts-sep">·</span>
        <span
          class="ts-reading"
          :class="{ dim: zone !== 'utc' }"
          data-testid="cell-editor-timestamp-utc"
          >{{ reading.utc }}</span
        >
        <span class="ts-sep">·</span>
        <span class="ts-reading dim" data-testid="cell-editor-timestamp-relative">{{
          reading.relative
        }}</span>
      </template>
      <span v-else class="ts-reading dim" data-testid="cell-editor-timestamp-unparseable"
        >Not a recognizable {{ format }} value</span
      >
    </div>

    <div class="ts-edit">
      <SegmentedControl
        v-model="zone"
        :options="ZONE_OPTIONS"
        data-testid="cell-editor-timestamp-zone"
      />
      <div class="ts-field">
        <TextField
          :model-value="fieldText"
          :disabled="readOnly"
          data-testid="cell-editor-timestamp-field"
          v-tooltip="'YYYY-MM-DD HH:mm:ss, in the zone selected above'"
          @update:model-value="onFieldInput"
        />
      </div>
      <span class="ts-calendar-anchor">
        <IconButton
          icon="calendar"
          :disabled="readOnly"
          data-testid="cell-editor-timestamp-calendar"
          v-tooltip="'Pick a date and time'"
          @click="calendarOpen = !calendarOpen"
        />
        <PopoverPanel
          v-if="calendarOpen"
          :width="228"
          anchor="left"
          test-id="cell-editor-timestamp-calendar-popover"
          backdrop-testid="cell-editor-timestamp-calendar-backdrop"
          @close="calendarOpen = false"
        >
          <DateTimePicker :model-value="pickerDate" :zone="zone" @update:model-value="onPick" />
        </PopoverPanel>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ts-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ts-readings {
  flex-shrink: 0;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-4);
}

.ts-reading {
  white-space: nowrap;
}

.ts-sep {
  opacity: 0.5;
}

.ts-edit {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3) var(--kira-s-4);
}

.ts-field {
  flex: 1;
  min-width: 0;
}

.ts-field :deep(.p-input) {
  width: 100%;
}

.ts-calendar-anchor {
  position: relative;
  flex-shrink: 0;
}
</style>
