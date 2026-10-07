<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type { CustomScript } from '@shared/domain/scripts';
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
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { computed, ref, useTemplateRef } from 'vue';
import type { TerminalScriptsSeam } from './module';

// Adds one quick command (`script === null`) or edits one. `scripts` is a prop, not
// `useTerminalModule()`: TerminalPanel.vue owns the seam and mounts this per open.
const props = defineProps<{ scripts: TerminalScriptsSeam; script: CustomScript | null }>();
const emit = defineEmits<{ close: [] }>();

const colors = PALETTE_COLOR_CHOICES;

const name = ref(props.script?.name ?? '');
const command = ref(props.script?.command ?? '');
const workingDir = ref(props.script?.workingDir ?? '');
const collection = ref(props.script?.collection ?? '');
const color = ref<PaletteColor>((props.script?.color as PaletteColor | undefined) ?? 'none');
const error = ref<string | null>(null);
const saving = ref(false);

const collectionNames = computed(() => [
  ...new Set(
    props.scripts
      .records()
      .map((s) => s.collection)
      .filter((c) => c !== ''),
  ),
]);

// The dialog's own affordance: the Go check stays the authority on every other rule.
const canSave = computed(() => name.value.trim() !== '' && command.value.trim() !== '');

async function save(): Promise<void> {
  if (!canSave.value || saving.value) return;
  error.value = null;
  saving.value = true;
  const fields = {
    name: name.value.trim(),
    command: command.value.trim(),
    workingDir: workingDir.value.trim(),
    color: color.value,
    collection: collection.value.trim(),
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
      data-testid="quick-commands-dialog"
      class="flex flex-col gap-0 p-0 w-150 max-w-[90vw] max-h-4/5"
      @open-auto-focus="onOpenAutoFocus"
      @keydown.meta.enter.prevent="save"
      @keydown.ctrl.enter.prevent="save"
    >
      <DialogHeader>
        <DialogTitle>{{ script ? 'Edit quick command' : 'Add quick command' }}</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="quick-commands-dialog-close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-auto p-3">
        <Field>
          <FieldLabel for="quick-command-name">Name</FieldLabel>
          <Input
            id="quick-command-name"
            ref="nameEl"
            v-model="name"
            placeholder="Build"
            data-testid="custom-script-name"
          />
        </Field>

        <Field>
          <FieldLabel for="quick-command-script">Script</FieldLabel>
          <Textarea
            id="quick-command-script"
            v-model="command"
            rows="8"
            spellcheck="false"
            placeholder="npm run build"
            class="field-sizing-fixed min-h-40 resize-y font-data leading-normal"
            data-testid="custom-script-command"
          />
          <FieldDescription>
            Runs in your login shell; lines run in order. Press Cmd/Ctrl+Enter to save.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel for="quick-command-dir">Working directory</FieldLabel>
          <Input
            id="quick-command-dir"
            v-model="workingDir"
            placeholder="Terminal default directory"
            class="font-data"
            data-testid="custom-script-workingdir"
          />
        </Field>

        <div class="flex items-end gap-3">
          <Field class="flex-1 min-w-0">
            <FieldLabel for="quick-command-collection">Collection</FieldLabel>
            <Input
              id="quick-command-collection"
              v-model="collection"
              list="quick-command-collections"
              placeholder="Optional"
              maxlength="64"
              data-testid="custom-script-collection"
            />
          </Field>
          <fieldset
            class="color-picker m-0 flex h-control flex-wrap items-center gap-1 border-0 p-0"
            aria-label="Colour"
          >
            <Tooltip v-for="swatch in colors" :key="swatch">
              <TooltipTrigger as-child>
                <SwatchRadio
                  name="quick-command-color"
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
        <datalist id="quick-command-collections">
          <option v-for="existing in collectionNames" :key="existing" :value="existing" />
        </datalist>

        <FieldError v-if="error" data-testid="custom-script-error">{{ error }}</FieldError>
      </div>

      <DialogFooter class="justify-end">
        <DialogClose as-child>
          <Button variant="dialog" size="kira-lg" data-testid="custom-script-cancel">Cancel</Button>
        </DialogClose>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!canSave || saving"
          data-testid="custom-script-save"
          @click="save"
        >
          {{ script ? 'Save' : 'Add' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
