<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, reactive, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../state/customScripts';
import type { SettingsPaneProps } from './types';

// P104 §3: ColorPicker inlined -- the offered subset (not the full storable enum), same as its
// own `colors` constant.
const scriptColors = PALETTE_COLOR_CHOICES;

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Scripts'"` branch — P85 §10.2's own section. Bypasses
// draft/pendingPatch entirely (same posture as 'Database MCP'): the
// custom scripts store is a Pinia store, not a settings leaf, and a script edited here must apply
// immediately so the tab strip's own dropdown reflects it without a Save.
defineProps<SettingsPaneProps>();

const confirmDialogStore = useConfirmDialogStore();
const customScriptsStore = useCustomScriptsStore();

interface ScriptDraft {
  name: string;
  command: string;
  workingDir: string;
}
const scriptDrafts = reactive<Record<string, ScriptDraft>>({});
function syncScriptDrafts(): void {
  for (const key of Object.keys(scriptDrafts)) delete scriptDrafts[key];
  for (const script of customScriptsStore.records) {
    scriptDrafts[script.id] = {
      name: script.name,
      command: script.command,
      workingDir: script.workingDir,
    };
  }
}
watch(() => customScriptsStore.records, syncScriptDrafts, { immediate: true });

// name/command commit on blur, not per keystroke (§10.2); a cleared field reverts rather than
// saving an invalid row — VariableSetView.vue's own onEnvFieldBlur takes the same "empty reverts"
// posture for a name field, and model.CustomScriptFields.Validate would reject it anyway.
async function onScriptFieldBlur(script: CustomScript): Promise<void> {
  const draft = scriptDrafts[script.id];
  if (!draft) return;
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (name === '' || command === '') {
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
    return;
  }
  if (
    name === script.name &&
    command === script.command &&
    draft.workingDir === script.workingDir
  ) {
    return;
  }
  try {
    await customScriptsStore.updateCustomScript(script.id, {
      name,
      command,
      workingDir: draft.workingDir,
      color: script.color,
    });
  } catch {
    // A rejected edit (e.g. a non-absolute workingDir) never arrives via the broadcast to
    // overwrite this draft, so revert it here instead of leaving unsaved text on screen.
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
  }
}

// §10.2/VariableSetView.vue's own D17/D19: a swatch click applies immediately, unlike
// name/command's blur-commit — a colour choice is a discrete action with its own visible
// feedback, not text a user is still composing.
async function onScriptColorChange(script: CustomScript, color: PaletteColor): Promise<void> {
  await customScriptsStore.updateCustomScript(script.id, {
    name: script.name,
    command: script.command,
    workingDir: script.workingDir,
    color,
  });
}

async function onRemoveScript(script: CustomScript): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Remove "${script.name}"? It will no longer launch from the tab strip or the Terminal panel.`,
    {
      danger: true,
    },
  );
  if (ok) await customScriptsStore.removeCustomScript(script.id);
}

const newScriptName = ref('');
const newScriptCommand = ref('');
const newScriptWorkingDir = ref('');
const newScriptColor = ref<PaletteColor>('none');
const scriptError = ref<string | null>(null);

// The dialog's own affordance (§10.3's "the Go check is the authority, the zod one is the
// affordance") — disables Add before a round trip rather than duplicating Validate's full rule.
const canAddScript = computed(
  () => newScriptName.value.trim() !== '' && newScriptCommand.value.trim() !== '',
);

async function onAddScript(): Promise<void> {
  if (!canAddScript.value) return;
  scriptError.value = null;
  const fields: CustomScriptFields = {
    name: newScriptName.value.trim(),
    command: newScriptCommand.value.trim(),
    workingDir: newScriptWorkingDir.value.trim(),
    color: newScriptColor.value,
  };
  try {
    await customScriptsStore.createCustomScript(fields);
    newScriptName.value = '';
    newScriptCommand.value = '';
    newScriptWorkingDir.value = '';
    newScriptColor.value = 'none';
  } catch (err) {
    scriptError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="contents" v-show="active">
    <FieldDescription>
      Each script becomes an entry in the tab strip's "+" button and the Terminal module's
      own quick-command panel, opening a new terminal tab running its command. An empty
      working directory falls back to the Terminal module's own default directory.
    </FieldDescription>

    <div
      v-if="customScriptsStore.records.length"
      class="flex flex-col max-h-80 overflow-y-auto gap-1.5"
      data-testid="custom-script-list"
    >
      <div
        v-for="script in customScriptsStore.records"
        :key="script.id"
        class="flex flex-col gap-1 py-1.5 border-b border-border"
        :data-testid="`custom-script-${script.id}`"
      >
        <div class="flex items-center gap-1.5">
          <div class="flex flex-col flex-1 min-w-0">
            <Input
              v-model="scriptDrafts[script.id].name"
              placeholder="Name"
              class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
              data-testid="custom-script-name"
              @blur="onScriptFieldBlur(script)"
            />
          </div>
          <fieldset
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
          <Input
            v-model="scriptDrafts[script.id].command"
            placeholder="Command"
            class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
            data-testid="custom-script-command"
            @blur="onScriptFieldBlur(script)"
          />
        </div>
        <div class="flex flex-col w-full">
          <Input
            v-model="scriptDrafts[script.id].workingDir"
            placeholder="Home directory"
            class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
            data-testid="custom-script-workingdir"
            @blur="onScriptFieldBlur(script)"
          />
        </div>
      </div>
    </div>
    <FieldDescription v-else>
      No scripts yet. Add one to launch it from the tab strip's + button.
    </FieldDescription>

    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <div class="flex flex-col flex-1 min-w-0">
          <Input
            v-model="newScriptName"
            placeholder="Name"
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
        <Input
          v-model="newScriptCommand"
          placeholder="Command"
          class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
          data-testid="custom-script-add-command"
        />
      </div>
      <div class="flex flex-col w-full">
        <Input
          v-model="newScriptWorkingDir"
          placeholder="Home directory"
          class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
          data-testid="custom-script-add-workingdir"
        />
      </div>
    </div>
    <FieldError v-if="scriptError" data-testid="custom-script-error">{{
      scriptError
    }}</FieldError>
  </div>
</template>
