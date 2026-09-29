<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { useTimeoutFn } from '@vueuse/core';
import { copyOrReportError } from '@workbench/util/clipboard';
import { ref, watch } from 'vue';
import { control } from '../bridge/control';
import { chipStyle } from './tones';
import type { QueueTag } from './useQueue';

// P129 Part 6 §0.9/§0.11/§0.14: one Branch/Jira/PR row (mockup `linkRow`, 1401-1440). A generic
// presentational row — `AdeDetailsTab.vue` decides which of the three display modes applies
// (`showLink`/`showBase`/`showInput`) and supplies the already-resolved text; this component only
// renders that state and reports the two user actions (`save`, `pick` for the new-work `from`
// select) back up.
const props = defineProps<{
  label: string;
  showLink: boolean;
  showBase: boolean;
  showInput: boolean;
  editable: boolean;
  editing: boolean;
  url: string | null;
  refText: string;
  title: string;
  hasStatus: boolean;
  status: string;
  statusTone: QueueTag['tone'];
  statusTip: string;
  draftValue: string;
  placeholder: string;
  baseValue: string;
  baseOptions: { value: string; label: string }[];
  error: string | null;
}>();

const emit = defineEmits<{
  edit: [];
  save: [value: string];
  base: [value: string];
}>();

const draft = ref(props.draftValue);
watch(
  () => [props.editing, props.draftValue] as const,
  ([editing, value]) => {
    if (editing) draft.value = value;
  },
  { immediate: true },
);

const copied = ref(false);
const { start: startCopiedTimeout } = useTimeoutFn(() => (copied.value = false), 1200, {
  immediate: false,
});

async function onCopy(): Promise<void> {
  const text = props.url ?? props.refText;
  if (!text) return;
  await copyOrReportError(
    text,
    () => {},
    () => {
      copied.value = true;
      startCopiedTimeout();
    },
  );
}

function onOpen(e: MouseEvent): void {
  e.preventDefault();
  if (props.url) void control.linkOpenExternal(props.url);
}

function onSave(): void {
  emit('save', draft.value);
}
</script>

<template>
  <template v-if="label">
    <span class="text-kira-sm text-muted-foreground">{{ label }}</span>
  </template>
  <div class="flex h-7 min-w-0 items-center gap-2">
    <template v-if="showLink">
      <span v-if="hasStatus" :title="statusTip" :style="chipStyle(statusTone)">{{ status }}</span>
      <a
        v-if="url"
        :href="url"
        target="_blank"
        rel="noopener"
        class="shrink-0 max-w-[55%] truncate font-data text-kira-sm"
        @click="onOpen"
        >{{ refText }}</a
      >
      <span v-else class="shrink-0 max-w-[55%] truncate font-data text-kira-sm">{{ refText }}</span>
      <span class="min-w-0 flex-1 truncate text-kira-sm text-subtle">{{ title }}</span>
      <button
        type="button"
        class="size-[22px] shrink-0 rounded text-muted-foreground"
        :aria-label="`Copy ${label} link`"
        title="Copy link"
        @click="onCopy"
      >
        <CodiconIcon :name="copied ? 'check' : 'copy'" :size="12" />
      </button>
      <button
        v-if="editable"
        type="button"
        class="size-[22px] shrink-0 rounded text-muted-foreground"
        :aria-label="`Edit ${label} link`"
        title="Edit"
        @click="emit('edit')"
      >
        <CodiconIcon name="edit" :size="12" />
      </button>
    </template>
    <template v-if="showBase">
      <span :title="statusTip" :style="chipStyle(statusTone)">{{ status }}</span>
      <label class="text-kira-sm text-muted-foreground" for="ade-draft-base">from</label>
      <NativeSelect
        id="ade-draft-base"
        :model-value="baseValue"
        class="max-w-[220px] font-data text-kira-sm"
        @update:model-value="(v) => emit('base', String(v))"
      >
        <option v-for="opt in baseOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </NativeSelect>
      <span class="min-w-0 truncate text-kira-sm text-subtle">branch created on Start</span>
    </template>
    <template v-if="showInput">
      <label class="sr-only" :for="`ade-link-${label}`">{{ label }} link</label>
      <Input
        :id="`ade-link-${label}`"
        v-model="draft"
        :placeholder="placeholder"
        class="h-6 min-w-0 flex-1 border-dashed font-data text-kira-sm"
      />
      <Button variant="dialog" size="sm" class="h-6 shrink-0 px-2" @click="onSave">Save</Button>
    </template>
  </div>
  <span v-if="error" class="col-start-2 text-kira-sm text-error" data-testid="ade-link-row-error">{{
    error
  }}</span>
</template>
