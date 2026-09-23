<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, nextTick, ref, watch } from 'vue';
import DateTimePicker from '../DateTimePicker.vue';
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
function setZone(v: string): void {
  zone.value = v as 'local' | 'utc';
}
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
const calendarAnchorRef = ref<HTMLElement | null>(null);
const calendarTriggerEl = ref<{ $el: HTMLElement } | null>(null);
const pickerDate = computed(() => parsed.value?.date ?? new Date());

// P104: the day cell that stages a pick lives inside PopoverContent, which reka teleports to
// document.body — outside `.editor-body`'s own DOM subtree. Its own onEditorBlur only stages when
// focus crosses that subtree's boundary (`container.contains(next)`), so once the day cell (never
// itself inside `.editor-body`) is removed from the DOM on close, the browser drops focus with no
// element inside `.editor-body` to blur *from* — the next explicit focus (format/status/etc.)
// fires no focusout at all, and the pick is silently lost (cell-editor.spec.ts's day-pick-then-
// blur scenario caught it). Returning focus to this trigger on close (the old, non-teleported
// PopoverPanel's own implicit behavior) restores a real element inside `.editor-body` to blur from.
watch(calendarOpen, (open) => {
  if (!open) void nextTick(() => calendarTriggerEl.value?.$el.focus());
});
</script>

<template>
  <div class="ts-pane" data-testid="cell-editor-timestamp-pane">
    <Alert class="ts-readings strip-note" data-testid="cell-editor-timestamp">
      <AlertDescription class="strip-note-text flex items-center gap-1">
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
      </AlertDescription>
    </Alert>

    <div class="ts-edit">
      <ToggleGroup
        type="single"
        :model-value="zone"
        data-testid="cell-editor-timestamp-zone"
        @update:model-value="(v) => v && setZone(v as string)"
      >
        <ToggleGroupItem v-for="opt in ZONE_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <div class="ts-field">
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex w-full" :aria-describedby="undefined">
              <Input
                :model-value="fieldText"
                :disabled="readOnly"
                class="w-full"
                data-testid="cell-editor-timestamp-field"
                @update:model-value="onFieldInput(String($event))"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>YYYY-MM-DD HH:mm:ss, in the zone selected above</TooltipContent>
        </Tooltip>
      </div>
      <Popover :open="calendarOpen" @update:open="calendarOpen = $event">
        <span ref="calendarAnchorRef" class="ts-calendar-anchor">
          <Tooltip>
            <TooltipTrigger as-child>
              <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
                <Button
                  ref="calendarTriggerEl"
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Pick a date and time"
                  :disabled="readOnly"
                  data-testid="cell-editor-timestamp-calendar"
                  @click="calendarOpen = !calendarOpen"
                >
                  <CodiconIcon name="calendar" :size="13" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Pick a date and time</TooltipContent>
          </Tooltip>
          <PopoverAnchor :reference="calendarAnchorRef ?? undefined" />
        </span>
        <PopoverContent align="start" class="w-[228px] gap-0 p-0" data-testid="cell-editor-timestamp-calendar-popover">
          <DateTimePicker :model-value="pickerDate" :zone="zone" @update:model-value="onPick" />
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.ts-pane {
  @apply flex flex-col h-full min-h-0;
}

.ts-readings {
  @apply shrink-0;
}

.ts-reading {
  @apply whitespace-nowrap;
}

.ts-sep {
  @apply opacity-50;
}

.ts-edit {
  @apply flex-1 min-h-0 flex items-start gap-1 py-1.5 px-2;
}

.ts-field {
  @apply flex-1 min-w-0;
}

.ts-calendar-anchor {
  @apply relative shrink-0;
}

/* Alert tone class replacing the raw .p-strip note marker (P104 §9 rule 5: literal hex, not a
   --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-[#a8c8ee];
}
</style>
