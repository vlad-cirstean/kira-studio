<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Textarea } from '@theme/components/ui/textarea';
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useSaveWorkflowYaml, useValidateWorkflowYaml, useWorkflowYaml } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { WorkflowEntry, WorkflowError } from '../wire';
import AdeWorkflowSaveBar from './AdeWorkflowSaveBar.vue';
import { useSaveShortcut } from './useSaveShortcut';

// YAML mode (R27): validates 300 ms after a keystroke; Save writes the draft, Discard restores the
// saved text. The draft is the source while it has unsaved edits, so a push never resets it. Save
// sends the hash of the text the draft was edited from; a file changed elsewhere is refused with
// Reload and Overwrite, as in the graph editor.
const props = defineProps<{ entry: WorkflowEntry }>();

const wfUi = useAdeWorkflowsUiStore();
const yaml = useWorkflowYaml(() => props.entry.fileName);
const validate = useValidateWorkflowYaml();
const save = useSaveWorkflowYaml();

const draft = ref('');
const dirty = ref(false);
const saveError = ref('');
const baseHash = ref('');
const conflict = ref(false);
const checked = ref<{ error: WorkflowError | null } | null>(null);

watch(
  () => yaml.data.value,
  (data) => {
    if (!data || dirty.value) return;
    draft.value = data.yaml;
    baseHash.value = data.hash;
  },
  { immediate: true },
);

const error = computed(() => (checked.value ? checked.value.error : props.entry.error));
const message = computed(() => {
  const e = error.value;
  if (!e) return '';
  const text = e.message.replace(/^✕\s*/, '');
  return `✕ ${e.line > 0 ? `line ${e.line}: ` : ''}${text} (the last valid version stays in use)`;
});

const runValidate = useDebounceFn(async () => {
  const text = draft.value;
  try {
    const res = await validate.mutateAsync({ yaml: text });
    if (draft.value === text) checked.value = { error: res.error };
  } catch (err) {
    if (draft.value === text) {
      checked.value = { error: { line: 0, message: err instanceof Error ? err.message : String(err) } };
    }
  }
}, 300);

watch(dirty, (v) => {
  wfUi.dirty = v;
});

async function saveNow(): Promise<void> {
  if (!dirty.value) return;
  const text = draft.value;
  try {
    const entry = await save.mutateAsync({
      fileName: props.entry.fileName,
      yaml: text,
      baseHash: baseHash.value,
    });
    saveError.value = '';
    conflict.value = false;
    baseHash.value = entry.hash;
    if (draft.value === text) dirty.value = false;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
    conflict.value = (err as { code?: string }).code === 'E_CONFLICT';
  }
}

function resetTo(data: { yaml: string; hash: string } | undefined): void {
  draft.value = data?.yaml ?? '';
  baseHash.value = data?.hash ?? '';
  dirty.value = false;
  saveError.value = '';
  conflict.value = false;
  checked.value = null;
}

function discard(): void {
  resetTo(yaml.data.value);
}

async function reload(): Promise<void> {
  resetTo((await yaml.refetch()).data);
}

async function overwrite(): Promise<void> {
  const fresh = (await yaml.refetch()).data;
  if (!fresh) return;
  baseHash.value = fresh.hash;
  conflict.value = false;
  await saveNow();
}

function onInput(v: string | number): void {
  draft.value = String(v);
  dirty.value = true;
  void runValidate();
}

const root = useTemplateRef<HTMLElement>('root');
useSaveShortcut(root, () => void saveNow());

onBeforeUnmount(() => {
  wfUi.dirty = false;
});
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    ref="root"
    data-testid="ade-wf-yaml-pane"
  >
    <AdeWorkflowSaveBar :dirty="dirty" :saving="save.isPending.value" @save="saveNow" @discard="discard" />
    <label for="ade-wf-yaml" class="sr-only">Workflow YAML</label>
    <Textarea
      id="ade-wf-yaml"
      :model-value="draft"
      spellcheck="false"
      class="resize-y bg-bg px-3 py-3 font-data leading-relaxed [tab-size:2]"
      data-testid="ade-wf-yaml"
      @update:model-value="onInput"
    />
    <div v-if="!error" class="text-kira-sm text-ok" data-testid="ade-wf-yaml-msg">
      ✓ valid · the form and the plan use this file
    </div>
    <div v-else role="alert" class="font-data text-kira-sm text-error" data-testid="ade-wf-yaml-msg">{{ message }}</div>
    <div v-if="saveError" class="text-kira-sm text-error" data-testid="ade-wf-save-error">
      {{ saveError }}
      <template v-if="conflict">
        <Button variant="link" size="kira" class="px-1 text-kira-sm text-info" data-testid="ade-wf-reload" @click="reload">
          Reload
        </Button>
        <Button variant="link" size="kira" class="px-1 text-kira-sm text-info" data-testid="ade-wf-overwrite" @click="overwrite">
          Overwrite
        </Button>
      </template>
    </div>
  </div>
</template>
