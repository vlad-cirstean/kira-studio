<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldError } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { type MessageKey, t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { errorText } from '@workbench/bridge/codedError';
import SortableList from '@workbench/components/SortableList.vue';
import { computed, ref } from 'vue';
import { useSaveStatuses } from '../../ade/v2/queries';
import { useBoard } from '../../ade/v2/readQueries';
import { TONE_SOLID_CLASS } from '../../ade/v2/tones';
import type { TaskStatusDef } from '../../ade/v2/wire';
import TaskStatusName from './TaskStatusName.vue';
import type { SettingsPaneProps } from './types';

// Self-saving: every edit writes the whole set at once, like a Plan write, so no draft or Save.
defineProps<SettingsPaneProps>();

const TONES = ['grey', 'amber', 'red', 'green', 'blue', 'purple'] as const;
const CATEGORIES = ['todo', 'active', 'review', 'done'] as const;
const CATEGORY_LABEL: Record<TaskStatusDef['category'], MessageKey> = {
  todo: 'space.ade.statuses.category.todo.label',
  active: 'space.ade.statuses.category.active.label',
  review: 'space.ade.statuses.category.review.label',
  done: 'common.done.status',
};

const board = useBoard();
const save = useSaveStatuses();
const statuses = computed(() => board.data.value?.statuses ?? []);
const ids = computed(() => statuses.value.map((s) => s.id));
const error = ref('');
const fresh = ref('');

const inUse = computed(() => {
  const n: Record<string, number> = {};
  for (const task of board.data.value?.tasks ?? []) n[task.statusId] = (n[task.statusId] ?? 0) + 1;
  return n;
});

function lastOfCategory(s: TaskStatusDef): boolean {
  return statuses.value.filter((o) => o.category === s.category).length < 2;
}

async function commit(
  next: TaskStatusDef[],
  reassign: Record<string, string> = {},
): Promise<TaskStatusDef[] | null> {
  error.value = '';
  try {
    return (await save.mutateAsync({ statuses: next, reassign })).statuses;
  } catch (err) {
    error.value = errorText(err);
    return null;
  }
}

function edit(id: string, patch: Partial<TaskStatusDef>): Promise<TaskStatusDef[] | null> {
  return commit(statuses.value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

async function rename(s: TaskStatusDef, name: string): Promise<void> {
  if (!(await edit(s.id, { name }))) throw new Error(error.value);
}

const toneItems = TONES.map((tone) => ({
  value: tone,
  label: t(`common.colour.${tone}.label` as MessageKey),
  testid: `ade-status-tone-${tone}`,
}));

function uniqueName(): string {
  const base = t('space.ade.statuses.newName.label');
  const taken = new Set(statuses.value.map((s) => s.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

async function add(): Promise<void> {
  const before = new Set(ids.value);
  const next = [
    ...statuses.value,
    { id: '', name: uniqueName(), tone: 'grey', category: 'active' } satisfies TaskStatusDef,
  ];
  const saved = await commit(next);
  if (saved) fresh.value = saved.find((s) => !before.has(s.id))?.id ?? '';
}

function move(from: string, to: string): void {
  const next = [...statuses.value];
  const i = next.findIndex((s) => s.id === from);
  const j = next.findIndex((s) => s.id === to);
  if (i < 0 || j < 0) return;
  next.splice(j, 0, ...next.splice(i, 1));
  void commit(next);
}

// ---- delete
const removing = ref<TaskStatusDef | null>(null);
const reassignTo = ref('');
const targets = computed(() => statuses.value.filter((s) => s.id !== removing.value?.id));

function remove(s: TaskStatusDef): void {
  if ((inUse.value[s.id] ?? 0) === 0) {
    void commit(statuses.value.filter((o) => o.id !== s.id));
    return;
  }
  removing.value = s;
  reassignTo.value =
    targets.value.find((o) => o.category === s.category)?.id ?? targets.value[0]?.id ?? '';
}

async function confirmRemove(): Promise<void> {
  const s = removing.value;
  if (!s) return;
  const ok = await commit(
    statuses.value.filter((o) => o.id !== s.id),
    { [s.id]: reassignTo.value },
  );
  if (ok) removing.value = null;
}
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <FieldDescription>{{ t('space.ade.statuses.description') }}</FieldDescription>
      <div class="flex flex-col gap-1" data-testid="ade-status-list">
        <SortableList
          :ids="ids"
          draggable="[data-status-id]"
          handle='[data-testid="ade-status-handle"]'
          keyboard-handle='[data-testid="ade-status-handle"]'
          class="flex flex-col gap-1"
          @move="move"
        >
          <div
            v-for="s in statuses"
            :key="s.id"
            class="flex items-center gap-2"
            :data-status-id="s.id"
            data-testid="ade-status-row"
          >
            <button
              type="button"
              class="cursor-grab text-muted-foreground"
              :aria-label="t('mobile.backlog.handle.aria')"
              data-testid="ade-status-handle"
            >
              <CodiconIcon name="gripper" :size="13" />
            </button>
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="toolbar"
                  size="kira"
                  :aria-label="t('common.field.colour.label')"
                  data-testid="ade-status-tone"
                >
                  <span class="size-3 rounded-full" :class="TONE_SOLID_CLASS[s.tone]" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-auto p-1.5" data-testid="ade-status-tones">
                <SecondaryTabs
                  variant="segmented"
                  :items="toneItems"
                  :model-value="s.tone"
                  :aria-label="t('common.field.colour.label')"
                  @update:model-value="(v) => v !== s.tone && edit(s.id, { tone: v as TaskStatusDef['tone'] })"
                >
                  <template #item="{ item }">
                    <span
                      class="size-3 rounded-full"
                      :class="TONE_SOLID_CLASS[item.value as TaskStatusDef['tone']]"
                    />
                  </template>
                </SecondaryTabs>
              </PopoverContent>
            </Popover>
            <TaskStatusName
              class="min-w-0 flex-1"
              :name="s.name"
              :label="t('common.field.name.label')"
              :focus="s.id === fresh"
              :commit="(name) => rename(s, name)"
              data-testid="ade-status-name"
            />
            <NativeSelect
              variant="bordered"
              :model-value="s.category"
              :aria-label="t('space.ade.statuses.category.label')"
              data-testid="ade-status-category"
              @update:model-value="(v) => edit(s.id, { category: String(v) as TaskStatusDef['category'] })"
            >
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{
                t(CATEGORY_LABEL[c])
              }}</option>
            </NativeSelect>
            <TooltipIconButton
              :icon="ICON.delete"
              :label="lastOfCategory(s) ? t('space.ade.statuses.lastOfCategory.tooltip') : t('space.ade.statuses.delete.tooltip')"
              :aria-label="t('space.ade.statuses.delete.tooltip')"
              :disabled="lastOfCategory(s)"
              disabled-trigger
              data-testid="ade-status-delete"
              @click="remove(s)"
            />
          </div>
        </SortableList>
      </div>
      <FieldDescription>{{ t('space.ade.statuses.category.description') }}</FieldDescription>
      <FieldError v-if="error" data-testid="ade-status-error">{{ error }}</FieldError>
      <div>
        <Button variant="dialog" size="kira" data-testid="ade-status-add" @click="add">
          <CodiconIcon :name="ICON.add" :size="12" />
          {{ t('space.ade.statuses.add.label') }}
        </Button>
      </div>
    </Field>

    <Dialog :open="removing !== null" @update:open="(o) => !o && (removing = null)">
      <DialogContent size="sm" :dirty="false" data-testid="ade-status-delete-dialog">
        <DialogHeader>
          <DialogTitle>{{ t('space.ade.statuses.deleteDialog.title') }}</DialogTitle>
          <DialogDescription>{{
            t('space.ade.statuses.deleteDialog.body', {
              count: inUse[removing?.id ?? ''] ?? 0,
              status: removing?.name ?? '',
            })
          }}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label for="ade-status-reassign">{{ t('space.ade.statuses.reassign.label') }}</Label>
          <NativeSelect
            id="ade-status-reassign"
            v-model="reassignTo"
            variant="bordered"
            data-testid="ade-status-reassign"
          >
            <option v-for="o in targets" :key="o.id" :value="o.id">{{ o.name }}</option>
          </NativeSelect>
          <FieldError v-if="error">{{ error }}</FieldError>
        </DialogBody>
        <DialogFooter>
          <Button variant="dialog" size="kira-lg" @click="removing = null">{{
            t('common.action.cancel.label')
          }}</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="ade-status-delete-confirm"
            @click="confirmRemove"
            >{{
              t('common.action.delete.label')
            }}</Button
          >
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
