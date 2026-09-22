<script setup lang="ts">
import type { PaletteColor } from '@shared/domain/color';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import AppButton from '@theme/primitives/AppButton.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, reactive, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../state/customScripts';
import ColorPicker from '../../theme/primitives/ColorPicker.vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Scripts'"` branch — P85 §10.2's own section. Bypasses
// draft/pendingPatch entirely (same posture as 'Connected editors'/'Database MCP' before it): the
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
  <div class="settings-pane" v-show="active">
    <p class="helper-text">
      Each script becomes an entry in the tab strip's "+" button and the Terminal module's
      own quick-command panel, opening a new terminal tab running its command. An empty
      working directory falls back to the Terminal module's own default directory.
    </p>

    <div
      v-if="customScriptsStore.records.length"
      class="custom-script-list"
      data-testid="custom-script-list"
    >
      <div
        v-for="script in customScriptsStore.records"
        :key="script.id"
        class="custom-script-row"
        :data-testid="`custom-script-${script.id}`"
      >
        <div class="script-row-top">
          <div class="script-name">
            <TextField
              v-model="scriptDrafts[script.id].name"
              placeholder="Name"
              size="md"
              data-testid="custom-script-name"
              @blur="onScriptFieldBlur(script)"
            />
          </div>
          <ColorPicker
            :model-value="script.color"
            label="Script colour"
            @update:model-value="(color) => onScriptColorChange(script, color)"
          />
          <IconButton
            icon="trash"
            data-testid="custom-script-remove"
            v-tooltip="'Remove this script'"
            @click="onRemoveScript(script)"
          />
        </div>
        <div class="script-command">
          <TextField
            v-model="scriptDrafts[script.id].command"
            placeholder="Command"
            size="md"
            class="mono"
            data-testid="custom-script-command"
            @blur="onScriptFieldBlur(script)"
          />
        </div>
        <div class="script-workingdir">
          <TextField
            v-model="scriptDrafts[script.id].workingDir"
            placeholder="Active repository"
            size="md"
            data-testid="custom-script-workingdir"
            @blur="onScriptFieldBlur(script)"
          />
        </div>
      </div>
    </div>
    <p v-else class="helper-text">
      No scripts yet. Add one to launch it from the tab strip's + button.
    </p>

    <div class="custom-script-add">
      <div class="script-row-top">
        <div class="script-name">
          <TextField
            v-model="newScriptName"
            placeholder="Name"
            size="md"
            data-testid="custom-script-add-name"
          />
        </div>
        <ColorPicker v-model="newScriptColor" label="Script colour" />
        <AppButton
          kind="dialog"
          :disabled="!canAddScript"
          data-testid="custom-script-add"
          @click="onAddScript"
          >Add</AppButton
        >
      </div>
      <div class="script-command">
        <TextField
          v-model="newScriptCommand"
          placeholder="Command"
          size="md"
          class="mono"
          data-testid="custom-script-add-command"
        />
      </div>
      <div class="script-workingdir">
        <TextField
          v-model="newScriptWorkingDir"
          placeholder="Active repository"
          size="md"
          data-testid="custom-script-add-workingdir"
        />
      </div>
    </div>
    <span v-if="scriptError" class="field-error" data-testid="custom-script-error">{{
      scriptError
    }}</span>
  </div>
</template>
