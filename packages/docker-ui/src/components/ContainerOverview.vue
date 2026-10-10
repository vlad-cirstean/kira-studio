<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { copyText } from '@workbench/util/clipboard';
import { reactive } from 'vue';
import type { DockerContainerDetail } from '../wire';
import DetailSection from './DetailSection.vue';

const props = defineProps<{ detail: DockerContainerDetail }>();

const revealed = reactive(new Set<number>());

function splitEnv(entry: string): { key: string; value: string } {
  const i = entry.indexOf('=');
  return i === -1 ? { key: entry, value: '' } : { key: entry.slice(0, i), value: entry.slice(i + 1) };
}

function toggle(i: number): void {
  if (revealed.has(i)) revealed.delete(i);
  else revealed.add(i);
}

const dateOrDash = (s: string): string => (s && !s.startsWith('0001-') ? new Date(s).toLocaleString() : '-');
const join = (parts: string[]): string => parts.join(' ') || '-';

const rows = (): Array<[string, string]> => [
  ['Command', join(props.detail.command)],
  ['Entrypoint', join(props.detail.entrypoint)],
  ['Working dir', props.detail.workingDir || '-'],
  ['User', props.detail.user || '-'],
  ['Restart policy', props.detail.restartPolicy || 'no'],
  ['Health', props.detail.health || '-'],
  ['Created', new Date(props.detail.container.created * 1000).toLocaleString()],
  ['Started', dateOrDash(props.detail.startedAt)],
  ['Finished', dateOrDash(props.detail.finishedAt)],
  ['Exit code', props.detail.container.state === 'running' ? '-' : String(props.detail.exitCode)],
];
</script>

<template>
  <div class="h-full overflow-auto p-3" data-testid="docker-overview">
    <div class="@container">
      <div class="grid grid-cols-1 items-start gap-3 @3xl:grid-cols-2">
        <DetailSection title="Details">
          <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <template v-for="[k, v] in rows()" :key="k">
              <dt class="text-muted-foreground">{{ k }}</dt>
              <dd class="break-all font-data">{{ v }}</dd>
            </template>
          </dl>
        </DetailSection>

        <div class="flex min-w-0 flex-col gap-3">
          <DetailSection v-if="detail.container.ports.length" title="Ports">
            <div v-for="p in detail.container.ports" :key="`${p.ip}:${p.publicPort}:${p.privatePort}/${p.type}`" class="font-data" data-testid="docker-overview-port">
              {{ p.publicPort ? `${p.ip || '0.0.0.0'}:${p.publicPort} -> ` : '' }}{{ p.privatePort }}/{{ p.type }}
            </div>
          </DetailSection>

          <DetailSection v-if="detail.networkAttachments.length" title="Networks">
            <div v-for="n in detail.networkAttachments" :key="n.network" class="font-data" data-testid="docker-overview-network">
              {{ n.network }}
              <span class="text-muted-foreground">{{ n.ipAddress }}{{ n.aliases.length ? ` (${n.aliases.join(', ')})` : '' }}</span>
            </div>
          </DetailSection>

          <DetailSection v-if="detail.mounts.length" title="Mounts">
            <div v-for="m in detail.mounts" :key="m.destination" class="break-all font-data" data-testid="docker-overview-mount">
              {{ m.name || m.source }} -> {{ m.destination }}
              <span class="text-muted-foreground">{{ m.type }}{{ m.rw ? '' : ', read-only' }}</span>
            </div>
          </DetailSection>

          <p
            v-if="!detail.container.ports.length && !detail.networkAttachments.length && !detail.mounts.length"
            class="px-1 text-muted-foreground"
            data-testid="docker-overview-bare"
          >No ports, networks or mounts.</p>
        </div>

        <DetailSection v-if="detail.env.length" title="Environment" class="@3xl:col-span-2">
          <div
            v-for="(entry, i) in detail.env"
            :key="i"
            class="group/env -mx-1 flex items-center gap-1 rounded-kira-sm px-1 font-data hover:bg-hover"
            data-testid="docker-env-row"
          >
            <span class="shrink-0 text-muted-foreground">{{ splitEnv(entry).key }}=</span>
            <span class="min-w-0 flex-1 break-all" data-testid="docker-env-value">{{ revealed.has(i) ? splitEnv(entry).value : '••••••••' }}</span>
            <TooltipIconButton :icon="revealed.has(i) ? 'eye-closed' : 'eye'" :label="revealed.has(i) ? 'Hide value' : 'Reveal value'" data-testid="docker-env-reveal" @click="toggle(i)" />
            <TooltipIconButton icon="copy" label="Copy value" @click="copyText(splitEnv(entry).value)" />
          </div>
        </DetailSection>

        <DetailSection v-if="Object.keys(detail.labels).length" title="Labels" class="@3xl:col-span-2">
          <div v-for="(v, k) in detail.labels" :key="k" class="break-all font-data">
            <span class="text-muted-foreground">{{ k }}=</span>{{ v }}
          </div>
        </DetailSection>
      </div>
    </div>
  </div>
</template>
