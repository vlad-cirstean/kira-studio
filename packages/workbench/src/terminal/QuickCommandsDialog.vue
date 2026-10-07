<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { FieldDescription, FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { computed, reactive, ref, useTemplateRef, watch } from 'vue';
import type { TerminalScriptsSeam } from './module';
import { useRemoveScript } from './scriptActions';

// P133 §2.2: one manager dialog listing every script as an editable row, not a per-script form —
// "Manage…" needs somewhere to open, and Settings' own create path (all four fields, with the
// error shown) has to live somewhere too. ScriptsPane.vue's rules (§2.3) moved here verbatim.
// `scripts` is a prop, not `useTerminalModule()` — TerminalPanel.vue mounts this only inside its
// own `v-if="scripts"` branch, so the type stays non-optional (UpdateDialog.vue's store-as-prop
// precedent).
const props = defineProps<{ scripts: TerminalScriptsSeam; focusId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const removeScript = useRemoveScript();

const scriptColors = PALETTE_COLOR_CHOICES;

const collectionNames = computed(() => [
  ...new Set(props.scripts.records().map((s) => s.collection).filter((c) => c !== '')),
]);

const error = ref<string | null>(null);

interface ScriptDraft {
  name: string;
  command: string;
  workingDir: string;
  collection: string;
}
const scriptDrafts = reactive<Record<string, ScriptDraft>>({});
const FIELDS = ['name', 'command', 'workingDir', 'collection'] as const;
// Last-seen records: a broadcast overwrites only the draft fields the user has not touched, so a
// round trip landing mid-typing (or another window's edit) never erases the text being typed.
let seen = new Map<string, ScriptDraft>();
function syncScriptDrafts(): void {
  const next = new Map<string, ScriptDraft>();
  for (const script of props.scripts.records()) {
    const record = {
      name: script.name,
      command: script.command,
      workingDir: script.workingDir,
      collection: script.collection,
    };
    next.set(script.id, record);
    const draft = scriptDrafts[script.id];
    const prev = seen.get(script.id);
    if (!draft || !prev) {
      scriptDrafts[script.id] = { ...record };
      continue;
    }
    for (const field of FIELDS) if (draft[field] === prev[field]) draft[field] = record[field];
  }
  for (const id of seen.keys()) if (!next.has(id)) delete scriptDrafts[id];
  seen = next;
}
watch(() => props.scripts.records(), syncScriptDrafts, { immediate: true });

// Rule 4: a rejected swatch change never arrives via a broadcast to move `:checked` off the
// clicked radio, so the native input stays checked while the prop it's bound to never changed —
// a second click on it would then fire no `change` at all. Bumping this per-row counter into the
// fieldset's own `:key` remounts it, snapping every radio back to `:checked` (no DOM poking).
const colorSyncKey = reactive<Record<string, number>>({});

// name/command commit on blur, not per keystroke; a cleared field reverts rather than saving an
// invalid row.
async function onScriptFieldBlur(script: CustomScript): Promise<void> {
  const draft = scriptDrafts[script.id];
  if (!draft) return;
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (name === '' || command === '') {
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
    draft.collection = script.collection;
    return;
  }
  if (
    name === script.name &&
    command === script.command &&
    draft.workingDir === script.workingDir &&
    draft.collection.trim() === script.collection
  ) {
    return;
  }
  error.value = null;
  try {
    await props.scripts.update(script.id, {
      name,
      command,
      workingDir: draft.workingDir,
      color: script.color,
      collection: draft.collection,
    });
  } catch (err) {
    // A rejected edit (e.g. a non-absolute workingDir) never arrives via the broadcast to
    // overwrite this draft, so revert it here instead of leaving unsaved text on screen — and show
    // why, since this dialog is now the only place a quick command's working directory gets set.
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
    draft.collection = script.collection;
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// A swatch click applies immediately, unlike name/command's blur-commit — a colour choice is a
// discrete action with its own visible feedback, not text still being composed.
async function onScriptColorChange(script: CustomScript, color: PaletteColor): Promise<void> {
  error.value = null;
  try {
    await props.scripts.update(script.id, {
      name: script.name,
      command: script.command,
      workingDir: script.workingDir,
      color,
      collection: script.collection,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    colorSyncKey[script.id] = (colorSyncKey[script.id] ?? 0) + 1;
  }
}

async function onRemoveScript(script: CustomScript): Promise<void> {
  error.value = null;
  try {
    await removeScript(props.scripts, script);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const newScriptName = ref('');
const newScriptCommand = ref('');
const newScriptWorkingDir = ref('');
const newScriptCollection = ref('');
const newScriptColor = ref<PaletteColor>('none');

// The dialog's own affordance — disables Add before a round trip rather than duplicating
// model.CustomScriptFields.Validate's full rule (the Go check is the authority).
const canAddScript = computed(
  () => newScriptName.value.trim() !== '' && newScriptCommand.value.trim() !== '',
);

async function onAddScript(): Promise<void> {
  if (!canAddScript.value) return;
  error.value = null;
  const fields: CustomScriptFields = {
    name: newScriptName.value.trim(),
    command: newScriptCommand.value.trim(),
    workingDir: newScriptWorkingDir.value.trim(),
    color: newScriptColor.value,
    collection: newScriptCollection.value.trim(),
  };
  try {
    await props.scripts.create(fields);
    newScriptName.value = '';
    newScriptCommand.value = '';
    newScriptWorkingDir.value = '';
    newScriptCollection.value = '';
    newScriptColor.value = 'none';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// §2.2's own focus rule: an "Edit…" click's row gets focused once the dialog paints, any other
// open focuses the add form, instead of reka's default (the dialog's own first focusable element).
const bodyEl = useTemplateRef<HTMLElement>('bodyEl');
function onOpenAutoFocus(e: Event): void {
  const selector = props.focusId
    ? `[data-script-id="${props.focusId}"] [data-testid="custom-script-name"]`
    : '[data-testid="custom-script-add-name"]';
  const target = bodyEl.value?.querySelector<HTMLElement>(selector);
  if (!target) return; // removed in another window — fall back to default focus
  e.preventDefault();
  target.scrollIntoView({ block: 'nearest' });
  target.focus();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent
      :show-close-button="false"
      data-testid="quick-commands-dialog"
      class="flex flex-col p-0 gap-0 w-150 max-h-4/5"
      @open-auto-focus="onOpenAutoFocus"
    >
      <DialogHeader>
        <DialogTitle>Quick commands</DialogTitle>
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

      <div ref="bodyEl" class="overflow-auto flex flex-col gap-2 p-3">
        <FieldDescription>
          Each quick command opens a new terminal tab running its command. An empty working
          directory uses the Terminal module's default directory.
        </FieldDescription>

        <div
          v-if="scripts.records().length"
          class="flex flex-col max-h-80 overflow-y-auto gap-1.5"
          data-testid="custom-script-list"
        >
          <div
            v-for="script in scripts.records()"
            :key="script.id"
            class="flex flex-col gap-1 py-1.5 border-b border-border"
            :data-testid="`custom-script-${script.id}`"
            :data-script-id="script.id"
          >
            <div class="flex items-center gap-1.5">
              <div class="flex flex-col flex-1 min-w-0">
                <Input
                  v-model="scriptDrafts[script.id].name"
                  placeholder="Name"
                  aria-label="Name"
                  class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                  data-testid="custom-script-name"
                  @blur="onScriptFieldBlur(script)"
                />
              </div>
              <fieldset
                :key="`${script.id}-${colorSyncKey[script.id] ?? 0}`"
                class="color-picker m-0 flex h-6.5 flex-wrap items-center gap-1 border-0 p-0"
                aria-label="Script colour"
              >
                <Tooltip v-for="color in scriptColors" :key="color">
                  <TooltipTrigger as-child>
                    <SwatchRadio
                      :name="`script-color-${script.id}`"
                      :value="color"
                      :color="color"
                      :checked="script.color === color"
                      @change="onScriptColorChange(script, color)"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{{ color === 'none' ? 'No colour' : color }}</TooltipContent>
                </Tooltip>
              </fieldset>
              <TooltipIconButton
                icon="trash"
                label="Remove this script"
                data-testid="custom-script-remove"
                @click="onRemoveScript(script)"
              />
            </div>
            <div class="flex flex-col w-full">
              <Textarea
                v-model="scriptDrafts[script.id].command"
                rows="2"
                placeholder="Command"
                aria-label="Command"
                class="min-h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 py-1 font-data leading-normal"
                data-testid="custom-script-command"
                @blur="onScriptFieldBlur(script)"
              />
            </div>
            <div class="flex flex-col w-full">
              <Input
                v-model="scriptDrafts[script.id].workingDir"
                placeholder="Default directory"
                aria-label="Working directory"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                data-testid="custom-script-workingdir"
                @blur="onScriptFieldBlur(script)"
              />
            </div>
            <div class="flex flex-col w-full">
              <Input
                v-model="scriptDrafts[script.id].collection"
                list="quick-command-collections"
                placeholder="Collection (optional)"
                aria-label="Collection"
                maxlength="64"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                data-testid="custom-script-collection"
                @blur="onScriptFieldBlur(script)"
              />
            </div>
          </div>
        </div>
        <FieldDescription v-else>No quick commands yet.</FieldDescription>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-1.5">
            <div class="flex flex-col flex-1 min-w-0">
              <Input
                v-model="newScriptName"
                placeholder="Name"
                aria-label="Name"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                data-testid="custom-script-add-name"
              />
            </div>
            <fieldset
              class="color-picker m-0 flex h-6.5 flex-wrap items-center gap-1 border-0 p-0"
              aria-label="Script colour"
            >
              <Tooltip v-for="color in scriptColors" :key="color">
                <TooltipTrigger as-child>
                  <SwatchRadio
                    name="new-script-color"
                    :value="color"
                    :color="color"
                    :checked="newScriptColor === color"
                    @change="newScriptColor = color"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ color === 'none' ? 'No colour' : color }}</TooltipContent>
              </Tooltip>
            </fieldset>
            <Button
              variant="dialog"
              size="kira-lg"
              :disabled="!canAddScript"
              data-testid="custom-script-add"
              @click="onAddScript"
              >Add</Button
            >
          </div>
          <div class="flex flex-col w-full">
            <Textarea
              v-model="newScriptCommand"
              rows="2"
              placeholder="Command"
              aria-label="Command"
              class="min-h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 py-1 font-data leading-normal"
              data-testid="custom-script-add-command"
              @keydown.meta.enter.prevent="onAddScript"
              @keydown.ctrl.enter.prevent="onAddScript"
            />
          </div>
          <div class="flex flex-col w-full">
            <Input
              v-model="newScriptWorkingDir"
              placeholder="Default directory"
              aria-label="Working directory"
              class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
              data-testid="custom-script-add-workingdir"
            />
          </div>
          <div class="flex flex-col w-full">
            <Input
              v-model="newScriptCollection"
              list="quick-command-collections"
              placeholder="Collection (optional)"
              aria-label="Collection"
              maxlength="64"
              class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
              data-testid="custom-script-add-collection"
            />
          </div>
        </div>
        <datalist id="quick-command-collections">
          <option v-for="name in collectionNames" :key="name" :value="name" />
        </datalist>
        <FieldError v-if="error" data-testid="custom-script-error">{{ error }}</FieldError>
      </div>
    </DialogContent>
  </Dialog>
</template>
