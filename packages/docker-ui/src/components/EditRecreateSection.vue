<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { computed } from 'vue';
import { deepEqual, toNumber } from '../lib/editDiff';
import { useVolumes } from '../queries';
import type { EditDraft } from '../state/dockerEdit';
import type { DockerRecreateSpec } from '../wire';
import EditField from './EditField.vue';
import EditRows from './EditRows.vue';

const props = defineProps<{ draft: EditDraft; errors: Record<string, string>; disabled: boolean; preserved: string[] }>();

const rc = computed(() => props.draft.recreate);
const base = computed(() => props.draft.base.recreate);
const volumes = useVolumes();
const volumeNames = computed(() => (volumes.data.value ?? []).map((v) => v.name));

const changed = (k: keyof DockerRecreateSpec): boolean => !deepEqual(base.value[k], rc.value[k]);

const lines = (key: 'cmd' | 'entrypoint') =>
  computed({
    get: () => rc.value[key].join('\n'),
    set: (text: string) => {
      rc.value[key] = text === '' ? [] : text.split('\n');
    },
  });
const cmdText = lines('cmd');
const entrypointText = lines('entrypoint');

const split = (entry: string): [string, string] => {
  const i = entry.indexOf('=');
  return i === -1 ? [entry, ''] : [entry.slice(0, i), entry.slice(i + 1)];
};

function setEnv(index: number, key: string, value: string): void {
  rc.value.env[index] = `${key}=${value}`;
}

const labelEntries = computed(() => Object.entries(rc.value.labels));

function setLabel(index: number, key: string, value: string): void {
  const entries = Object.entries(rc.value.labels);
  entries[index] = [key, value];
  rc.value.labels = Object.fromEntries(entries);
}

function removeLabel(index: number): void {
  rc.value.labels = Object.fromEntries(Object.entries(rc.value.labels).filter((_, i) => i !== index));
}

function addLabel(): void {
  if (!('' in rc.value.labels)) rc.value.labels = { ...rc.value.labels, '': '' };
}

function addPort(): void {
  rc.value.ports.push({ containerPort: 80, proto: 'tcp', hostIp: '', hostPort: '' });
}

function addMount(): void {
  rc.value.mounts.push({ key: '', type: 'volume', source: '', target: '/', readOnly: false });
}
</script>

<template>
  <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-2" data-testid="docker-edit-recreate">
    <EditField field="image" label="Image" mode="recreate" :changed="changed('image')" :error="errors['recreate.image']" hint="The image must already be present locally.">
      <Input v-model="rc.image" :disabled="disabled" data-testid="docker-edit-image" />
    </EditField>

    <EditField field="user" label="User" mode="recreate" :changed="changed('user')">
      <Input v-model="rc.user" placeholder="image default" :disabled="disabled" data-testid="docker-edit-user" />
    </EditField>

    <EditField field="hostname" label="Hostname" mode="recreate" :changed="changed('hostname')" hint="Empty uses the container ID.">
      <Input v-model="rc.hostname" :disabled="disabled" data-testid="docker-edit-hostname" />
    </EditField>

    <EditField field="entrypoint" label="Entrypoint (one argument per line)" mode="recreate" :changed="changed('entrypoint')">
      <Textarea v-model="entrypointText" class="font-data" :disabled="disabled" data-testid="docker-edit-entrypoint" />
    </EditField>

    <EditField field="cmd" label="Command (one argument per line)" mode="recreate" :changed="changed('cmd')">
      <Textarea v-model="cmdText" class="font-data" :disabled="disabled" data-testid="docker-edit-cmd" />
    </EditField>

    <EditField field="env" label="Environment" mode="recreate" :changed="changed('env')" :error="errors['recreate.env']">
      <EditRows :items="rc.env" add-label="Add variable" :disabled="disabled" testid="docker-edit-env" @add="rc.env.push('=')" @remove="rc.env.splice($event, 1)">
        <template #row="{ item, index }">
          <Input class="w-40" placeholder="KEY" :model-value="split(item)[0]" :disabled="disabled" data-testid="docker-edit-env-key" @update:model-value="setEnv(index, String($event), split(item)[1])" />
          <Input class="min-w-0 flex-1" placeholder="value" :model-value="split(item)[1]" :disabled="disabled" data-testid="docker-edit-env-value" @update:model-value="setEnv(index, split(item)[0], String($event))" />
        </template>
      </EditRows>
    </EditField>

    <EditField field="labels" label="Labels" mode="recreate" :changed="changed('labels')">
      <EditRows :items="labelEntries" add-label="Add label" :disabled="disabled" testid="docker-edit-labels" @add="addLabel" @remove="removeLabel">
        <template #row="{ item, index }">
          <Input class="w-40" placeholder="key" :model-value="item[0]" :disabled="disabled" data-testid="docker-edit-label-key" @update:model-value="setLabel(index, String($event), item[1])" />
          <Input class="min-w-0 flex-1" placeholder="value" :model-value="item[1]" :disabled="disabled" data-testid="docker-edit-label-value" @update:model-value="setLabel(index, item[0], String($event))" />
        </template>
      </EditRows>
    </EditField>

    <EditField field="ports" label="Ports" mode="recreate" :changed="changed('ports')" :error="errors['recreate.ports']" class="@2xl:col-span-2">
      <EditRows :items="rc.ports" add-label="Add port" :disabled="disabled" testid="docker-edit-ports" @add="addPort" @remove="rc.ports.splice($event, 1)">
        <template #row="{ item }">
          <Input class="w-24" type="number" placeholder="container" :model-value="item.containerPort" :disabled="disabled" data-testid="docker-edit-port-container" @update:model-value="item.containerPort = toNumber($event)" />
          <NativeSelect v-model="item.proto" class="w-20" :disabled="disabled" data-testid="docker-edit-port-proto">
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
            <option value="sctp">sctp</option>
          </NativeSelect>
          <Input class="w-36" placeholder="host IP" v-model="item.hostIp" :disabled="disabled" data-testid="docker-edit-port-ip" />
          <Input class="w-24" placeholder="host port" v-model="item.hostPort" :disabled="disabled" data-testid="docker-edit-port-host" />
        </template>
      </EditRows>
    </EditField>

    <EditField field="mounts" label="Mounts" mode="recreate" :changed="changed('mounts')" :error="errors['recreate.mounts']" class="@2xl:col-span-2">
      <datalist id="docker-edit-volumes">
        <option v-for="v in volumeNames" :key="v" :value="v" />
      </datalist>
      <EditRows :items="rc.mounts" add-label="Add mount" :disabled="disabled" testid="docker-edit-mounts" @add="addMount" @remove="rc.mounts.splice($event, 1)">
        <template #row="{ item }">
          <NativeSelect v-model="item.type" class="w-24" :disabled="disabled" data-testid="docker-edit-mount-type">
            <option value="volume">volume</option>
            <option value="bind">bind</option>
          </NativeSelect>
          <Input class="min-w-0 flex-1" placeholder="volume name or host path" :list="item.type === 'volume' ? 'docker-edit-volumes' : undefined" v-model="item.source" :disabled="disabled" data-testid="docker-edit-mount-source" />
          <Input class="min-w-0 flex-1" placeholder="/path/in/container" v-model="item.target" :disabled="disabled" data-testid="docker-edit-mount-target" />
          <span class="flex shrink-0 items-center gap-1 text-muted-foreground"><Switch v-model="item.readOnly" :disabled="disabled" data-testid="docker-edit-mount-ro" aria-label="Read-only" />ro</span>
        </template>
      </EditRows>
    </EditField>

    <EditField field="capAdd" label="Add capabilities" mode="recreate" :changed="changed('capAdd')">
      <EditRows :items="rc.capAdd" add-label="Add capability" :disabled="disabled" testid="docker-edit-cap-add" @add="rc.capAdd.push('')" @remove="rc.capAdd.splice($event, 1)">
        <template #row="{ index }">
          <Input class="min-w-0 flex-1" placeholder="NET_ADMIN" v-model="rc.capAdd[index]" :disabled="disabled" data-testid="docker-edit-cap-add-input" />
        </template>
      </EditRows>
    </EditField>

    <EditField field="capDrop" label="Drop capabilities" mode="recreate" :changed="changed('capDrop')">
      <EditRows :items="rc.capDrop" add-label="Drop capability" :disabled="disabled" testid="docker-edit-cap-drop" @add="rc.capDrop.push('')" @remove="rc.capDrop.splice($event, 1)">
        <template #row="{ index }">
          <Input class="min-w-0 flex-1" placeholder="MKNOD" v-model="rc.capDrop[index]" :disabled="disabled" data-testid="docker-edit-cap-drop-input" />
        </template>
      </EditRows>
    </EditField>

    <div v-if="preserved.length" class="text-muted-foreground @2xl:col-span-2" data-testid="docker-edit-preserved">
      <span class="font-medium">Kept as is:</span> {{ preserved.join(', ') }}
    </div>
  </div>
</template>
