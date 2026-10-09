<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type {
  CustomScript,
  ScriptDir,
  ScriptDirMode,
  ScriptKind,
  ScriptParam,
  SmartSettings,
} from '@shared/domain/scripts';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import SwatchRadio from '@theme/SwatchRadio.vue';
import type { TextPart } from '@theme/varText';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref, toRaw, useTemplateRef } from 'vue';
import type { ScriptsSeam } from './module';
import ParamsEditor from './ParamsEditor.vue';
import McpToolsField from './smart/McpToolsField.vue';
import SmartBadge from './smart/SmartBadge.vue';
import SmartSettingsFields from './smart/SmartSettingsFields.vue';
import { defaultSmart, varsUsed } from './smart/smartSettings';
import ToolsField from './smart/ToolsField.vue';

// Adds one script (`script === null`) or edits one. `scripts` is a prop, not
// `useAutomationsModule()`: AutomationsPanel.vue owns the seam and mounts this per open. `collectionId`
// presets the collection of a new script (added from a collection's own menu).
const props = defineProps<{
  scripts: ScriptsSeam;
  script: CustomScript | null;
  /** Kind of a new script; an edited script keeps its own. */
  kind?: ScriptKind;
  collectionId?: string | null;
  chooseFolder: (title: string) => Promise<string | null>;
  resolveDir: (scriptId: string) => Promise<ScriptDir>;
}>();
const emit = defineEmits<{ close: [] }>();

const colors = PALETTE_COLOR_CHOICES;
const title = computed(() => {
  const what = isSmart ? 'smart script' : 'script';
  return `${props.script ? 'Edit' : 'New'} ${what}`;
});

const kind: ScriptKind = props.script?.kind ?? props.kind ?? 'script';
const isSmart = kind === 'smart';
const name = ref(props.script?.name ?? '');
const params = ref<ScriptParam[]>(structuredClone(toRaw(props.script?.params ?? [])));
const smart = ref<SmartSettings>(
  structuredClone(toRaw(props.script?.smart ?? defaultSmart())),
);
const usedVars = computed(() => (isSmart ? varsUsed(command.value) : []));
const usesParts = computed<TextPart[]>(() => {
  const parts: TextPart[] = ['Uses: '];
  usedVars.value.forEach((v, i) => {
    if (i > 0) parts.push(', ');
    parts.push({ name: v, value: v });
  });
  return parts;
});
const command = ref(props.script?.command ?? '');
const dirMode = ref<ScriptDirMode>(props.script?.dirMode ?? 'kira');
const workingDir = ref(props.script?.workingDir ?? '');
const dir = useQuery(
  {
    queryKey: ['scriptRuns', 'dir', props.script?.id ?? ''],
    queryFn: () => props.resolveDir(props.script?.id ?? ''),
    staleTime: 0,
  },
  queryClient,
);
const blocker = computed(() => (dirMode.value === props.script?.dirMode ? (dir.data.value?.blocker ?? '') : ''));
const folderParts = computed<TextPart[]>(() => [
  { name: 'Kira home', value: dir.data.value?.base ?? '…' },
  '/automations/',
  { name: 'script id', value: props.script?.id ?? 'set on save' },
]);
const homeParts = computed<TextPart[]>(() => [
  'Runs in your home folder ',
  { name: 'HOME', value: dir.data.value?.base ?? '…' },
  ', the old default. New scripts use the Kira automations folder.',
]);
// '' is the select's "No collection" sentinel; the payload sends null.
const collection = ref(props.script?.collectionId ?? props.collectionId ?? '');
const color = ref<PaletteColor>((props.script?.color as PaletteColor | undefined) ?? 'none');
const error = ref<string | null>(null);
const saving = ref(false);

// The dialog's own affordance: the Go check stays the authority on every other rule.
const canSave = computed(
  () =>
    name.value.trim() !== '' &&
    command.value.trim() !== '' &&
    (dirMode.value !== 'fixed' || workingDir.value.trim() !== ''),
);

async function chooseWorkingDir(): Promise<void> {
  error.value = null;
  try {
    const path = await props.chooseFolder('Working directory…');
    if (path === null) return;
    workingDir.value = path;
    dirMode.value = 'fixed';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value) return;
  error.value = null;
  saving.value = true;
  const fields = {
    name: name.value.trim(),
    command: command.value.trim(),
    kind,
    params: params.value,
    smart: isSmart ? smart.value : null,
    dirMode: dirMode.value,
    workingDir: dirMode.value === 'fixed' ? workingDir.value.trim() : '',
    color: color.value,
    collectionId: collection.value === '' ? null : collection.value,
  };
  try {
    if (props.script) await props.scripts.update(props.script.id, fields);
    else await props.scripts.create(fields);
    emit('close');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

const nameEl = useTemplateRef<InstanceType<typeof Input>>('nameEl');
function onOpenAutoFocus(e: Event): void {
  e.preventDefault();
  (nameEl.value?.$el as HTMLElement | undefined)?.focus();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent
      :show-close-button="false"
      data-testid="script-dialog"
      class="flex flex-col gap-0 p-0 w-150 max-w-[90vw] max-h-4/5"
      @open-auto-focus="onOpenAutoFocus"
      @keydown.meta.enter.prevent="save"
      @keydown.ctrl.enter.prevent="save"
    >
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <SmartBadge v-if="isSmart" />
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="script-dialog-close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-auto p-3">
        <Field>
          <FieldLabel for="script-name">Name</FieldLabel>
          <Input
            id="script-name"
            ref="nameEl"
            v-model="name"
            placeholder="Build"
            data-testid="script-dialog-name"
          />
        </Field>

        <Field>
          <FieldLabel for="script-command">{{ isSmart ? 'Prompt' : 'Command' }}</FieldLabel>
          <Textarea
            id="script-command"
            v-model="command"
            rows="8"
            spellcheck="false"
            :placeholder="isSmart ? 'Summarize the open TODOs in this folder' : 'npm run build'"
            class="field-sizing-fixed min-h-40 resize-y font-data leading-normal"
            data-testid="script-dialog-command"
          />
          <FieldDescription v-if="isSmart" data-testid="script-dialog-uses">
            <template v-if="usedVars.length > 0"><VarText :parts="usesParts" /></template>
            <template v-else>Use {name} to insert a parameter. Press Cmd/Ctrl+Enter to save.</template>
          </FieldDescription>
          <FieldDescription v-else>
            Runs in your login shell; lines run in order. Press Cmd/Ctrl+Enter to save.
          </FieldDescription>
        </Field>

        <template v-if="isSmart">
          <SmartSettingsFields v-model="smart" />
          <ToolsField v-model="smart" />
          <McpToolsField v-model="smart" />
        </template>
        <ParamsEditor v-model="params" :kind="kind" />

        <Field>
          <FieldLabel>Working directory</FieldLabel>
          <RadioGroup
            :model-value="dirMode === 'home' ? '' : dirMode"
            class="gap-1.5"
            data-testid="script-dialog-dirmode"
            @update:model-value="(v) => (dirMode = v === 'fixed' ? 'fixed' : 'kira')"
          >
            <div class="flex items-center gap-2">
              <RadioGroupItem id="script-dir-kira" value="kira" data-testid="script-dialog-dir-kira" />
              <Label for="script-dir-kira">Kira automations folder</Label>
            </div>
            <div class="flex items-center gap-2">
              <RadioGroupItem id="script-dir-fixed" value="fixed" data-testid="script-dialog-dir-fixed" />
              <Label for="script-dir-fixed">Choose folder…</Label>
            </div>
          </RadioGroup>
          <div v-if="dirMode === 'fixed'" class="flex items-center gap-1.5">
            <span class="min-w-0 flex-1 truncate font-data" data-testid="script-dialog-workingdir">
              {{ workingDir || 'No folder chosen' }}
            </span>
            <Button variant="dialog" size="kira-lg" data-testid="script-dialog-workingdir-choose" @click="chooseWorkingDir">
              Choose…
            </Button>
          </div>
          <FieldDescription v-else-if="dirMode === 'home'" data-testid="script-dialog-home-notice">
            <VarText :parts="homeParts" />
            <Button
              variant="dialog"
              size="kira-lg"
              class="ml-2"
              data-testid="script-dialog-use-kira"
              @click="dirMode = 'kira'"
            >
              Use automations folder
            </Button>
          </FieldDescription>
          <FieldDescription v-else data-testid="script-dialog-dir-preview">
            <VarText :parts="folderParts" />
          </FieldDescription>
          <FieldError v-if="blocker" data-testid="script-dialog-dir-blocker">{{ blocker }}</FieldError>
        </Field>

        <div class="flex items-end gap-3">
          <Field class="flex-1 min-w-0">
            <FieldLabel for="script-collection">Collection</FieldLabel>
            <NativeSelect
              id="script-collection"
              v-model="collection"
              variant="bordered"
              size="kira-lg"
              data-testid="script-dialog-collection"
            >
              <option value="">No collection</option>
              <option v-for="c in scripts.collections()" :key="c.id" :value="c.id">{{ c.name }}</option>
            </NativeSelect>
          </Field>
          <fieldset
            class="color-picker m-0 flex h-control flex-wrap items-center gap-1 border-0 p-0"
            aria-label="Colour"
          >
            <Tooltip v-for="swatch in colors" :key="swatch">
              <TooltipTrigger as-child>
                <SwatchRadio
                  name="script-color"
                  :value="swatch"
                  :color="swatch"
                  :checked="color === swatch"
                  @change="color = swatch"
                />
              </TooltipTrigger>
              <TooltipContent>{{ swatch === 'none' ? 'No colour' : swatch }}</TooltipContent>
            </Tooltip>
          </fieldset>
        </div>
        <FieldError v-if="error" data-testid="script-dialog-error">{{ error }}</FieldError>
      </div>

      <DialogFooter class="justify-end">
        <DialogClose as-child>
          <Button variant="dialog" size="kira-lg" data-testid="script-dialog-cancel">Cancel</Button>
        </DialogClose>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!canSave || saving"
          data-testid="script-dialog-save"
          @click="save"
        >
          {{ script ? 'Save' : 'Add' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
