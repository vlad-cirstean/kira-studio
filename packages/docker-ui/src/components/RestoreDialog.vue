<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@theme/components/ui/collapsible';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { FieldError, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import { useDismissRestore, useRestoreContainers } from '../queries';
import type { DockerRestoreItem, DockerRestoreState } from '../wire';

const props = defineProps<{ state: DockerRestoreState }>();
const emit = defineEmits<{ close: [] }>();

interface Unit {
  key: string;
  project: string;
  items: DockerRestoreItem[];
  waiting: boolean;
}

const restore = useRestoreContainers();
const dismiss = useDismissRestore();
const unchecked = ref(new Set<string>());
const showBack = ref(false);

const open = computed(() =>
  props.state.items.filter((i) => i.status === 'restorable' || i.status === 'waiting'),
);
const back = computed(() => props.state.items.filter((i) => i.status === 'back'));
const gone = computed(() => props.state.items.filter((i) => i.status === 'gone'));

// A Compose project is one unit: its members start together, in dependency order.
const units = computed<Unit[]>(() => {
  const out: Unit[] = [];
  const projects = new Map<string, Unit>();
  for (const item of open.value) {
    const waiting = item.status === 'waiting';
    if (!item.composeProject) {
      out.push({ key: item.id, project: '', items: [item], waiting });
      continue;
    }
    let unit = projects.get(item.composeProject);
    if (!unit) {
      unit = {
        key: `project:${item.composeProject}`,
        project: item.composeProject,
        items: [],
        waiting: false,
      };
      projects.set(item.composeProject, unit);
      out.push(unit);
    }
    unit.items.push(item);
    unit.waiting ||= waiting;
  }
  return out;
});

const isChecked = (u: Unit) => !u.waiting && !unchecked.value.has(u.key);
const chosen = computed(() =>
  units.value.filter(isChecked).flatMap((u) => u.items.map((i) => i.id)),
);

function toggle(u: Unit, on: boolean | 'indeterminate'): void {
  const next = new Set(unchecked.value);
  if (on === true) next.delete(u.key);
  else next.add(u.key);
  unchecked.value = next;
}

const errors = computed(() => {
  const out = new Map<string, string>();
  for (const i of props.state.items) if (i.error) out.set(i.id, i.error);
  for (const r of restore.data.value?.items ?? []) if (!r.ok && r.error) out.set(r.id, r.error);
  return out;
});

async function submit(): Promise<void> {
  const res = await restore.mutateAsync({ engineId: props.state.engineId, ids: chosen.value });
  if (res.items.every((i) => i.ok)) emit('close');
}

async function dismissAll(): Promise<void> {
  await dismiss.mutateAsync(props.state.engineId);
  emit('close');
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent size="lg" data-testid="docker-restore-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('docker.restore.dialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('docker.restore.dialog.description') }}</DialogDescription>
      </DialogHeader>

      <DialogBody>
        <FieldSet v-if="units.length" data-testid="docker-restore-open">
          <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="u in units"
              :key="u.key"
              class="flex flex-col gap-0.5"
              :data-testid="u.project ? 'docker-restore-project' : 'docker-restore-row'"
              :data-project="u.project || undefined"
              :data-id="u.project ? undefined : u.items[0]?.id"
              :data-status="u.project ? undefined : u.items[0]?.status"
            >
              <div class="flex items-center gap-1.5">
                <Checkbox
                  :id="`restore-${u.key}`"
                  :model-value="isChecked(u)"
                  :disabled="u.waiting"
                  @update:model-value="(v) => toggle(u, v)"
                />
                <Label :for="`restore-${u.key}`" class="cursor-default">{{
                  u.project ? t('docker.restore.dialog.project.label', { name: u.project }) : u.items[0]?.name
                }}</Label>
                <template v-if="u.waiting">
                  <Spinner label="" />
                  <span class="text-kira-sm text-muted-foreground">{{
                    t('docker.restore.dialog.waiting.label')
                  }}</span>
                </template>
              </div>
              <ul
                v-if="u.project"
                class="m-0 flex list-none flex-col gap-0.5 pl-6 text-kira-sm text-muted-foreground"
              >
                <li
                  v-for="m in u.items"
                  :key="m.id"
                  data-testid="docker-restore-member"
                  :data-id="m.id"
                  :data-status="m.status"
                >
                  {{ m.name }}
                  <FieldError v-if="errors.get(m.id)" data-testid="docker-restore-error">{{
                    errors.get(m.id)
                  }}</FieldError>
                </li>
              </ul>
              <FieldError
                v-else-if="errors.get(u.items[0]?.id ?? '')"
                class="pl-6"
                data-testid="docker-restore-error"
                >{{
                  errors.get(u.items[0]?.id ?? '')
                }}</FieldError
              >
            </li>
          </ul>
        </FieldSet>

        <Collapsible v-if="back.length" v-model:open="showBack" data-testid="docker-restore-back">
          <CollapsibleTrigger as-child>
            <Button variant="toolbar" size="kira" data-testid="docker-restore-back-toggle">{{
              `${t('docker.restore.dialog.back.title')} (${back.length})`
            }}</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul class="m-0 flex list-none flex-col gap-0.5 p-0 text-kira-sm text-muted-foreground">
              <li
                v-for="i in back"
                :key="i.id"
                data-testid="docker-restore-row"
                :data-id="i.id"
                data-status="back"
                >{{
                  i.name
                }}</li
              >
            </ul>
          </CollapsibleContent>
        </Collapsible>

        <FieldSet v-if="gone.length" data-testid="docker-restore-gone">
          <FieldLegend>{{ t('docker.restore.dialog.gone.title') }}</FieldLegend>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0 text-kira-sm text-muted-foreground">
            <li
              v-for="i in gone"
              :key="i.id"
              data-testid="docker-restore-row"
              :data-id="i.id"
              data-status="gone"
              >{{ i.name }}
              · {{ t('docker.restore.dialog.gone.body') }}</li
            >
          </ul>
        </FieldSet>
      </DialogBody>

      <DialogFooter>
        <Button
          variant="dialog"
          size="kira-lg"
          :pending="dismiss.isPending.value"
          data-testid="docker-restore-dismiss"
          @click="dismissAll"
          >{{
            t('common.action.dismiss.label')
          }}</Button
        >
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :pending="restore.isPending.value"
          :disabled="chosen.length === 0"
          data-testid="docker-restore-submit"
          @click="submit"
        >
          {{ t('docker.restore.dialog.submit.label', { count: chosen.length }) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
