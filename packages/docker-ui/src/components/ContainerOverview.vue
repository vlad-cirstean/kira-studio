<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { copyText } from '@workbench/util/clipboard';
import { reactive } from 'vue';
import type { DockerContainerDetail } from '../wire';

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
  <div class="flex h-full flex-col gap-4 overflow-auto p-3" data-testid="docker-overview">
    <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      <template v-for="[k, v] in rows()" :key="k">
        <dt class="text-muted-foreground">{{ k }}</dt>
        <dd class="font-data break-all">{{ v }}</dd>
      </template>
    </dl>

    <section v-if="detail.container.ports.length">
      <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Ports</h3>
      <div v-for="p in detail.container.ports" :key="`${p.ip}:${p.publicPort}:${p.privatePort}/${p.type}`" class="font-data" data-testid="docker-overview-port">
        {{ p.publicPort ? `${p.ip || '0.0.0.0'}:${p.publicPort} -> ` : '' }}{{ p.privatePort }}/{{ p.type }}
      </div>
    </section>

    <section v-if="detail.mounts.length">
      <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Mounts</h3>
      <div v-for="m in detail.mounts" :key="m.destination" class="font-data break-all" data-testid="docker-overview-mount">
        {{ m.name || m.source }} -> {{ m.destination }}
        <span class="text-muted-foreground">{{ m.type }}{{ m.rw ? '' : ', read-only' }}</span>
      </div>
    </section>

    <section v-if="detail.networkAttachments.length">
      <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Networks</h3>
      <div v-for="n in detail.networkAttachments" :key="n.network" class="font-data" data-testid="docker-overview-network">
        {{ n.network }}
        <span class="text-muted-foreground">{{ n.ipAddress }}{{ n.aliases.length ? ` (${n.aliases.join(', ')})` : '' }}</span>
      </div>
    </section>

    <section v-if="detail.env.length">
      <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Environment</h3>
      <div v-for="(entry, i) in detail.env" :key="i" class="group/env flex items-center gap-1 font-data" data-testid="docker-env-row">
        <span class="shrink-0 text-muted-foreground">{{ splitEnv(entry).key }}=</span>
        <span class="min-w-0 flex-1 break-all" data-testid="docker-env-value">{{ revealed.has(i) ? splitEnv(entry).value : '••••••••' }}</span>
        <TooltipIconButton :icon="revealed.has(i) ? 'eye-closed' : 'eye'" :label="revealed.has(i) ? 'Hide value' : 'Reveal value'" data-testid="docker-env-reveal" @click="toggle(i)" />
        <TooltipIconButton icon="copy" label="Copy value" @click="copyText(splitEnv(entry).value)" />
      </div>
    </section>

    <section v-if="Object.keys(detail.labels).length">
      <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Labels</h3>
      <div v-for="(v, k) in detail.labels" :key="k" class="font-data break-all">
        <span class="text-muted-foreground">{{ k }}=</span>{{ v }}
      </div>
    </section>
  </div>
</template>
