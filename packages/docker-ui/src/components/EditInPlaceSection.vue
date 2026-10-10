<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { computed, provide, ref } from 'vue';
import { resourceMode, toNumber } from '../lib/editDiff';
import { inPlaceSectionKey } from '../lib/editSection';
import type { EditDraft } from '../state/dockerEdit';
import type { DockerResources, RestartPolicyName } from '../wire';
import EditField from './EditField.vue';
import EditSize from './EditSize.vue';

const props = defineProps<{
  draft: EditDraft;
  errors: Record<string, string>;
  disabled: boolean;
  networkLocked: boolean;
  engineCpus?: number;
  allNetworks: string[];
}>();

provide(inPlaceSectionKey, true);

const ip = computed(() => props.draft.inPlace);
const baseIp = computed(() => props.draft.base.inPlace);
const res = computed(() => ip.value.resources);
const baseRes = computed(() => baseIp.value.resources);

const mode = (k: keyof DockerResources) => resourceMode(baseRes.value, res.value, k);
const changed = (k: keyof DockerResources): boolean => baseRes.value[k] !== res.value[k];
const err = (k: keyof DockerResources): string | undefined => props.errors[`resources.${k}`];

const quotaMode = computed(() => res.value.cpuQuota !== 0 || res.value.cpuPeriod !== 0 || baseRes.value.cpuQuota !== 0);
const cpusText = computed(() => (res.value.nanoCpus > 0 ? String(res.value.nanoCpus / 1e9) : ''));
const cpuChanged = computed(() => changed('nanoCpus') || changed('cpuQuota') || changed('cpuPeriod'));
const cpuHint = computed(() => (props.engineCpus ? `Engine has ${props.engineCpus} CPUs` : ''));
const cpusetHint = computed(() => (props.engineCpus ? `Engine has ${props.engineCpus} CPUs (0-${props.engineCpus - 1})` : ''));

const RESTARTS: RestartPolicyName[] = ['no', 'always', 'on-failure', 'unless-stopped'];
const restartChanged = computed(
  () => ip.value.restart.name !== baseIp.value.restart.name || ip.value.restart.maxRetries !== baseIp.value.restart.maxRetries,
);

function setCpus(v: string | number): void {
  const n = toNumber(v);
  res.value.nanoCpus = n > 0 ? Math.round(n * 1e9) : 0;
}

function setRestart(v: unknown): void {
  ip.value.restart.name = v as RestartPolicyName;
  if (ip.value.restart.name !== 'on-failure') ip.value.restart.maxRetries = 0;
}

const available = computed(() => props.allNetworks.filter((n) => !ip.value.networks.some((x) => x.name === n)));
const toAdd = ref('');

function addNetwork(): void {
  if (!toAdd.value) return;
  ip.value.networks.push({ name: toAdd.value, aliases: [], ipv4: '', ipv6: '' });
  toAdd.value = '';
}

function removeNetwork(name: string): void {
  ip.value.networks = ip.value.networks.filter((n) => n.name !== name);
}

function setAliases(name: string, text: string): void {
  const n = ip.value.networks.find((x) => x.name === name);
  if (n) n.aliases = text.split(',').map((a) => a.trim()).filter(Boolean);
}

const noAliases = (name: string): boolean => name === 'bridge' || name === 'host' || name === 'none';
const netChanged = (name: string): boolean => {
  const b = baseIp.value.networks.find((n) => n.name === name);
  const d = ip.value.networks.find((n) => n.name === name);
  return !b || (d !== undefined && b.aliases.join(',') !== d.aliases.join(','));
};
</script>

<template>
  <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-2" data-testid="docker-edit-inplace">
    <EditField field="name" label="Name" mode="now" :changed="ip.name !== baseIp.name" :error="errors.name">
      <Input v-model="ip.name" :disabled="disabled" data-testid="docker-edit-name" />
    </EditField>

    <EditField field="restart" label="Restart policy" mode="now" :changed="restartChanged" :error="errors.restart">
      <div class="flex items-center gap-2">
        <NativeSelect :model-value="ip.restart.name" :disabled="disabled" data-testid="docker-edit-restart" @update:model-value="setRestart">
          <option v-for="r in RESTARTS" :key="r" :value="r">{{ r }}</option>
        </NativeSelect>
        <Input
          v-if="ip.restart.name === 'on-failure'"
          type="number"
          min="0"
          class="w-24"
          placeholder="retries"
          :model-value="ip.restart.maxRetries"
          :disabled="disabled"
          data-testid="docker-edit-restart-retries"
          @update:model-value="ip.restart.maxRetries = toNumber($event)"
        />
      </div>
    </EditField>

    <EditField
      v-if="!quotaMode"
      field="cpus"
      label="CPUs"
      :mode="mode('nanoCpus')"
      :changed="cpuChanged"
      :error="err('nanoCpus')"
      :hint="cpuHint"
    >
      <Input type="number" min="0" step="0.1" placeholder="no limit" :model-value="cpusText" :disabled="disabled" data-testid="docker-edit-cpus" @update:model-value="setCpus" />
    </EditField>
    <template v-else>
      <EditField field="cpuQuota" label="CPU quota (µs per period)" :mode="mode('cpuQuota')" :changed="changed('cpuQuota')" :error="err('cpuQuota')">
        <Input type="number" min="0" :model-value="res.cpuQuota" :disabled="disabled" data-testid="docker-edit-cpu-quota" @update:model-value="res.cpuQuota = toNumber($event)" />
      </EditField>
      <EditField field="cpuPeriod" label="CPU period (µs)" :mode="mode('cpuPeriod')" :changed="changed('cpuPeriod')" :error="err('cpuPeriod')">
        <Input type="number" min="0" :model-value="res.cpuPeriod" :disabled="disabled" data-testid="docker-edit-cpu-period" @update:model-value="res.cpuPeriod = toNumber($event)" />
      </EditField>
    </template>

    <EditField field="cpuShares" label="CPU shares" :mode="mode('cpuShares')" :changed="changed('cpuShares')" :error="err('cpuShares')">
      <Input type="number" min="0" placeholder="default" :model-value="res.cpuShares || ''" :disabled="disabled" data-testid="docker-edit-cpu-shares" @update:model-value="res.cpuShares = toNumber($event)" />
    </EditField>

    <EditField field="cpusetCpus" label="Cpuset CPUs" :mode="mode('cpusetCpus')" :changed="changed('cpusetCpus')" :error="err('cpusetCpus')" :hint="cpusetHint">
      <Input v-model="res.cpusetCpus" placeholder="e.g. 0-2" :disabled="disabled" data-testid="docker-edit-cpuset-cpus" />
    </EditField>

    <EditField field="cpusetMems" label="Cpuset memory nodes" :mode="mode('cpusetMems')" :changed="changed('cpusetMems')" :error="err('cpusetMems')">
      <Input v-model="res.cpusetMems" placeholder="e.g. 0" :disabled="disabled" data-testid="docker-edit-cpuset-mems" />
    </EditField>

    <EditField field="memory" label="Memory" :mode="mode('memory')" :changed="changed('memory')" :error="err('memory')">
      <EditSize v-model="res.memory" :disabled="disabled" testid="docker-edit-memory" />
    </EditField>

    <EditField field="memoryReservation" label="Memory reservation" :mode="mode('memoryReservation')" :changed="changed('memoryReservation')" :error="err('memoryReservation')">
      <EditSize v-model="res.memoryReservation" :disabled="disabled" testid="docker-edit-reservation" />
    </EditField>

    <EditField field="memorySwap" label="Swap (memory + swap)" :mode="mode('memorySwap')" :changed="changed('memorySwap')" :error="err('memorySwap')" hint="Swap limits need swap accounting; some engines ignore them with a warning.">
      <EditSize v-model="res.memorySwap" allow-unlimited :disabled="disabled" testid="docker-edit-swap" />
    </EditField>

    <EditField field="blkioWeight" label="Block IO weight" :mode="mode('blkioWeight')" :changed="changed('blkioWeight')" :error="err('blkioWeight')">
      <Input type="number" min="0" placeholder="default" :model-value="res.blkioWeight || ''" :disabled="disabled" data-testid="docker-edit-blkio" @update:model-value="res.blkioWeight = toNumber($event)" />
    </EditField>

    <EditField field="pidsLimit" label="PIDs limit" :mode="mode('pidsLimit')" :changed="changed('pidsLimit')" :error="err('pidsLimit')">
      <Input type="number" min="0" placeholder="unlimited" :model-value="res.pidsLimit || ''" :disabled="disabled" data-testid="docker-edit-pids" @update:model-value="res.pidsLimit = toNumber($event)" />
    </EditField>

    <EditField
      field="networks"
      label="Networks"
      mode="now"
      :changed="ip.networks.length !== baseIp.networks.length || ip.networks.some((n) => netChanged(n.name))"
      :error="errors.networks"
      :hint="networkLocked ? 'Networks cannot change in this network mode.' : 'Changing aliases briefly disconnects that network.'"
      class="@2xl:col-span-2"
    >
      <div class="flex flex-col gap-1.5" data-testid="docker-edit-networks">
        <div v-for="n in ip.networks" :key="n.name" class="flex items-center gap-2" data-testid="docker-edit-network" :data-name="n.name">
          <span class="w-40 shrink-0 truncate font-data">{{ n.name }}</span>
          <Input
            class="min-w-0 flex-1"
            placeholder="aliases, comma separated"
            :model-value="n.aliases.join(', ')"
            :disabled="disabled || networkLocked || noAliases(n.name)"
            data-testid="docker-edit-network-aliases"
            @change="setAliases(n.name, ($event.target as HTMLInputElement).value)"
          />
          <span v-if="n.ipv4 || n.ipv6" class="shrink-0 font-data text-muted-foreground" title="Static address, kept as is">{{ n.ipv4 || n.ipv6 }}</span>
          <TooltipIconButton icon="trash" label="Detach" :disabled="disabled || networkLocked" data-testid="docker-edit-network-remove" @click="removeNetwork(n.name)" />
        </div>
        <div class="flex items-center gap-2">
          <NativeSelect v-model="toAdd" class="w-48" :disabled="disabled || networkLocked" data-testid="docker-edit-network-select">
            <option value="">Attach to network…</option>
            <option v-for="n in available" :key="n" :value="n">{{ n }}</option>
          </NativeSelect>
          <Button size="kira" variant="toolbar" :disabled="disabled || networkLocked || !toAdd" data-testid="docker-edit-network-add" @click="addNetwork">Attach</Button>
        </div>
      </div>
    </EditField>
  </div>
</template>
