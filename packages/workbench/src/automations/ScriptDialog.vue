<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type {
  CustomScript,
  ScriptDir,
  ScriptDirMode,
  ScriptKind,
  ScriptParam,
  ScriptSchedule,
  SmartSettings,
} from '@shared/domain/scripts';
import { useQuery } from '@tanstack/vue-query';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { Switch } from '@theme/components/ui/switch';
import { Tabs, TabsContent } from '@theme/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import SwatchRadio from '@theme/SwatchRadio.vue';
import type { TextPart } from '@theme/varText';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { queryClient } from '@workbench/state/queryClient';
import { computed, reactive, ref, toRaw, useTemplateRef, watch } from 'vue';
import type { ScriptsSeam } from './module';
import ParamsEditor from './ParamsEditor.vue';
import ScriptBodyField from './ScriptBodyField.vue';
import ScheduleFields from './schedule/ScheduleFields.vue';
import { newSchedule } from './schedule/scheduleText';
import { ALL_SHOWN, type EditorTab, editorErrors, tabErrorCount } from './scriptErrors';
import McpToolsField from './smart/McpToolsField.vue';
import SmartBadge from './smart/SmartBadge.vue';
import SmartSettingsFields from './smart/SmartSettingsFields.vue';
import { defaultSmart } from './smart/smartSettings';
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
  /** Kira Space: offers the task-worktree switch. */
  ade?: boolean;
  /** Tab to open on; defaults to Script. */
  initialTab?: EditorTab;
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
// null: not recurring. Turning the switch off keeps the edits until Save.
const schedule = ref<ScriptSchedule | null>(
  structuredClone(toRaw(props.script?.schedule ?? null)),
);
const scheduleOk = ref(true);
const scheduleOn = computed({
  get: () => schedule.value !== null,
  set: (on: boolean) => {
    if (!on) schedule.value = null;
    else schedule.value ??= newSchedule();
  },
});
const command = ref(props.script?.command ?? '');
const dirMode = ref<ScriptDirMode>(props.script?.dirMode ?? 'kira');
const workingDir = ref(props.script?.workingDir ?? '');
const useAdeDir = ref(props.script?.useAdeDir ?? true);
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

const TABS: readonly { id: EditorTab; label: string }[] = [
  { id: 'script', label: 'Script' },
  { id: 'params', label: 'Parameters' },
  { id: 'schedule', label: 'Schedule' },
];
const tab = ref<EditorTab>(props.initialTab ?? 'script');
const tabItems = TABS.map((t) => ({ value: t.id, label: t.label, testid: `script-dialog-tab-${t.id}` }));

// Empty-field errors show once the field was edited; Save stays disabled until none remain.
const shown = reactive({ name: false, body: false, folder: false });
watch(name, () => (shown.name = true));
watch(command, () => (shown.body = true));
watch(dirMode, () => (shown.folder = true));
const draft = computed(() => ({
  kind,
  name: name.value,
  body: command.value,
  dirMode: dirMode.value,
  workingDir: workingDir.value,
  maxBudgetUsd: smart.value.maxBudgetUsd,
  params: params.value,
  schedule: schedule.value,
  scheduleOk: scheduleOk.value,
}));
const errors = computed(() => editorErrors(draft.value, shown));
const canSave = computed(() => {
  const all = editorErrors(draft.value, ALL_SHOWN);
  return TABS.every((t) => tabErrorCount(all, t.id) === 0);
});

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
    schedule: schedule.value,
    dirMode: dirMode.value,
    workingDir: dirMode.value === 'fixed' ? workingDir.value.trim() : '',
    color: color.value,
    collectionId: collection.value === '' ? null : collection.value,
    useAdeDir: useAdeDir.value,
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
      size="lg"
      data-testid="script-dialog"
      @open-auto-focus="onOpenAutoFocus"
      @keydown.meta.enter.prevent="save"
      @keydown.ctrl.enter.prevent="save"
    >
      <DialogHeader closable close-testid="script-dialog-close">
        <DialogTitle>{{ title }}</DialogTitle>
        <SmartBadge v-if="isSmart" />
      </DialogHeader>

      <Tabs :model-value="tab" class="flex min-h-0 flex-1 flex-col gap-0">
        <ViewToolbar class="px-3">
          <SecondaryTabs
            :model-value="tab"
            :items="tabItems"
            aria-label="Script editor tabs"
            @update:model-value="(v) => (tab = v as typeof tab)"
          >
            <template #item="{ item }">
              {{ item.label }}
              <Badge
                v-if="tabErrorCount(errors, item.value as EditorTab) > 0"
                variant="err"
                :data-testid="`script-dialog-tab-${item.value}-errors`"
                >{{ tabErrorCount(errors, item.value as EditorTab) }}</Badge
              >
            </template>
          </SecondaryTabs>
        </ViewToolbar>

        <DialogBody class="min-h-80">
          <TabsContent value="script" force-mount class="flex flex-col gap-3 data-[state=inactive]:hidden">
            <Field>
              <FieldLabel for="script-name">Name</FieldLabel>
              <Input
                id="script-name"
                ref="nameEl"
                v-model="name"
                placeholder="Build"
                :aria-invalid="!!errors.name"
                data-testid="script-dialog-name"
              />
              <FieldError v-if="errors.name" data-testid="script-dialog-name-error">{{ errors.name }}</FieldError>
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

            <ScriptBodyField v-model="command" :kind="kind" :params="params" :ade="!!ade" :error="errors.body" />

            <template v-if="isSmart">
              <SmartSettingsFields v-model="smart" />
              <FieldError v-if="errors.budget" data-testid="script-dialog-budget-error">{{ errors.budget }}</FieldError>
              <ToolsField v-model="smart" />
              <McpToolsField v-model="smart" />
            </template>

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
              <FieldError v-if="errors.folder" data-testid="script-dialog-folder-error">{{ errors.folder }}</FieldError>
            </Field>


            <Field v-if="ade" orientation="horizontal">
              <Switch id="script-use-ade-dir" v-model="useAdeDir" data-testid="script-use-ade-dir" />
              <Label for="script-use-ade-dir">Run in the task's worktree when started from ADE</Label>
            </Field>

          </TabsContent>

          <TabsContent value="params" force-mount class="flex flex-col gap-3 data-[state=inactive]:hidden">
            <ParamsEditor v-model="params" :kind="kind" :errors="errors.params" />
          </TabsContent>

          <TabsContent value="schedule" force-mount class="flex flex-col gap-3 data-[state=inactive]:hidden">
            <Field orientation="horizontal">
              <Switch id="script-schedule" v-model="scheduleOn" data-testid="script-schedule" />
              <Label for="script-schedule">Run on a schedule</Label>
            </Field>
            <ScheduleFields
              v-if="schedule"
              v-model="schedule"
              @valid="(ok) => (scheduleOk = ok)"
              :script-id="script?.id ?? null"
              :kind="kind"
              :params="params"
            />
            <FieldError v-if="errors.cron" data-testid="script-dialog-cron-error">{{ errors.cron }}</FieldError>
          </TabsContent>

          <FieldError v-if="error" data-testid="script-dialog-error">{{ error }}</FieldError>
        </DialogBody>
      </Tabs>

      <DialogFooter>
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
