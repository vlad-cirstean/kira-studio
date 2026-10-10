<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { computed, ref, watch } from 'vue';
import { useDocker } from '../context';
import { fieldErrors, hasNowChanges, inPlaceForApply } from '../lib/editDiff';
import { useContainerEditSpec, useDockerStatus, useNetworks, useRecreateContainer, useUpdateContainer } from '../queries';
import { type EditFailure, useDockerEditStore } from '../state/dockerEdit';
import { useDockerExecSessionsStore } from '../state/dockerExec';
import { useDockerUiStore } from '../state/dockerUi';
import DetailSection from './DetailSection.vue';
import EditInPlaceSection from './EditInPlaceSection.vue';
import EditPendingSummary from './EditPendingSummary.vue';
import EditRecreateSection from './EditRecreateSection.vue';
import OriginIcon from './OriginIcon.vue';
import RecreateConfirmDialog from './RecreateConfirmDialog.vue';

const props = defineProps<{ containerId: string }>();

const ctx = useDocker();
const ui = useDockerUiStore();
const store = useDockerEditStore();
const execSessions = useDockerExecSessionsStore();
const id = computed(() => props.containerId);
const specQuery = useContainerEditSpec(id);
const status = useDockerStatus();
const networks = useNetworks();
const update = useUpdateContainer();
const recreate = useRecreateContainer();
const confirming = ref(false);

watch(
  () => specQuery.data.value,
  (s) => {
    if (s) store.ensure(s);
  },
  { immediate: true },
);

const draft = computed(() => store.drafts[props.containerId]);
const base = computed(() => draft.value?.base);
const errors = computed(() => (draft.value ? fieldErrors(draft.value) : {}));
const inPlaceErrors = computed(() => Object.keys(errors.value).some((k) => !k.startsWith('recreate.')));
const anyErrors = computed(() => Object.keys(errors.value).length > 0);
const changes = computed(() => store.pending(props.containerId));
const inPlaceCount = computed(() => changes.value.filter((c) => c.section === 'inPlace').length);
const recreateCount = computed(() => changes.value.filter((c) => c.section === 'recreate').length);
const applying = computed(() => store.applying[props.containerId]);
const readOnly = computed(() => (base.value?.managed ?? '') !== '');
const networkLocked = computed(() => /^(host|none|container:)/.test(base.value?.networkMode ?? ''));
const allNetworks = computed(() => (networks.data.value ?? []).map((n) => n.name));
const engineCpus = computed(() => status.data.value?.engine?.cpus);

const canApplyNow = computed(
  () => !!draft.value && !applying.value && !inPlaceErrors.value && hasNowChanges(draft.value.base, draft.value),
);
const canRecreate = computed(
  () => !!base.value && !applying.value && !anyErrors.value && !base.value.autoRemove && changes.value.some((c) => c.mode === 'recreate'),
);

const outcome = computed(() => store.outcome[props.containerId]);
const failure = computed(() => store.failure[props.containerId]);

function toFailure(e: unknown): EditFailure {
  const err = e as Error & { code?: string; details?: { restored?: boolean } };
  return { message: err.message, code: err.code ?? 'E_INTERNAL', restored: err.details?.restored === true };
}

function fail(e: unknown): void {
  const f = toFailure(e);
  store.failure[props.containerId] = f;
  if (f.code === 'E_CONFLICT' && draft.value) draft.value.stale = true;
}

async function applyNow(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const cid = props.containerId;
  store.begin(cid, 'inPlace');
  try {
    const r = await update.mutateAsync({ id: cid, baseHash: d.base.baseHash, spec: inPlaceForApply(d.base.inPlace, d.inPlace) });
    store.outcome[cid] = { warnings: r.warnings };
    store.expectRebase(cid);
  } catch (e) {
    fail(e);
    if ((e as { code?: string }).code !== 'E_CONFLICT') store.expectRebase(cid);
  } finally {
    store.end(cid);
  }
}

async function confirmRecreate(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const cid = props.containerId;
  confirming.value = false;
  store.begin(cid, 'recreate');
  try {
    const r = await recreate.mutateAsync({ id: cid, baseHash: d.base.baseHash, inPlace: d.inPlace, recreate: d.recreate });
    execSessions.closeForContainer(ctx, cid);
    store.discard(cid);
    store.outcome[r.id] = { warnings: r.warnings };
    ui.select({ kind: 'container', id: r.id }, 'edit');
  } catch (e) {
    fail(e);
  } finally {
    store.end(cid);
  }
}

async function reload(): Promise<void> {
  store.discard(props.containerId);
  const fresh = (await specQuery.refetch()).data;
  if (fresh) store.ensure(fresh);
}

const originNotice = computed(() => {
  const b = base.value;
  if (!b) return '';
  switch (b.origin) {
    case 'compose':
      return `Managed by Compose project ${b.originName}. Edits here are not written to the compose file; the next docker compose up may revert them. A recreate makes Compose see a different container.`;
    case 'devcontainer':
      return `Dev container for ${b.originName}. The editor that created it may recreate it and drop these edits.`;
    case 'kind':
      return `Node of kind cluster ${b.originName}. Recreating it can break the cluster.`;
    case 'testcontainers':
      return 'Created by Testcontainers. Its session reaper still owns this container and removes it when the session ends.';
    case 'buildx':
      return `Buildx builder ${b.originName}. Builds may recreate it.`;
    default:
      return '';
  }
});
</script>

<template>
  <div class="@container h-full overflow-auto p-3" data-testid="docker-edit">
    <div v-if="!draft || !base" class="flex flex-col gap-2" aria-busy="true">
      <div class="h-6 w-1/3 animate-pulse rounded-kira-sm bg-field" />
      <div class="h-4 w-2/3 animate-pulse rounded-kira-sm bg-field" />
    </div>
    <div v-else class="flex flex-col gap-3">
      <Alert v-if="base.managed" variant="warn" data-testid="docker-edit-managed">
        <AlertDescription>
          This container is managed by {{ base.managed === 'kubernetes' ? 'Kubernetes' : 'Swarm' }}. Edit the workload instead; the orchestrator replaces edited containers.
        </AlertDescription>
      </Alert>
      <Alert v-if="originNotice" variant="note" data-testid="docker-edit-origin">
        <AlertDescription class="flex items-center gap-2">
          <OriginIcon :origin="base.origin" :name="base.originName" />{{ originNotice }}
        </AlertDescription>
      </Alert>
      <Alert v-if="base.autoRemove" variant="note" data-testid="docker-edit-autoremove">
        <AlertDescription>Auto-remove container: it cannot be recreated, and its restart policy cannot change.</AlertDescription>
      </Alert>
      <Alert v-if="draft.stale" variant="warn" data-testid="docker-edit-stale">
        <AlertDescription class="flex items-center gap-2">
          The container changed since the editor loaded.
          <Button size="kira" variant="secondary" data-testid="docker-edit-reload" @click="reload">Reload</Button>
        </AlertDescription>
      </Alert>
      <Alert v-if="failure" variant="destructive" data-testid="docker-edit-error">
        <AlertDescription>
          {{ failure.message }}
          <template v-if="failure.code === 'E_RECREATE_FAILED' && failure.restored"> The original container was restored.</template>
        </AlertDescription>
      </Alert>
      <Alert v-if="outcome?.warnings.length" variant="warn" data-testid="docker-edit-warnings">
        <AlertDescription>
          <div v-for="w in outcome.warnings" :key="w">{{ w }}</div>
        </AlertDescription>
      </Alert>

      <DetailSection v-if="changes.length" title="Pending changes">
        <EditPendingSummary :changes="changes" />
      </DetailSection>

      <div class="flex flex-col gap-3">
        <DetailSection title="Applied in place" data-testid="docker-edit-section-inplace">
          <template #actions>
            <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
              <Badge v-if="inPlaceCount" variant="count" data-testid="docker-edit-count-inplace">{{ inPlaceCount }}</Badge>
              <TooltipIconButton icon="discard" label="Reset" :disabled="!inPlaceCount" data-testid="docker-edit-reset-inplace" @click="store.reset(containerId, 'inPlace')" />
              <Button v-if="!readOnly" size="kira" variant="secondary" :disabled="!canApplyNow" data-testid="docker-edit-apply-now" @click="applyNow">
                <CodiconIcon v-if="applying === 'inPlace'" name="loading" :size="12" class="codicon-modifier-spin" />Apply
              </Button>
            </span>
          </template>
          <EditInPlaceSection :draft="draft" :errors="errors" :disabled="readOnly || !!applying" :network-locked="networkLocked" :engine-cpus="engineCpus" :all-networks="allNetworks" />
        </DetailSection>

        <DetailSection title="Requires recreate" data-testid="docker-edit-section-recreate">
          <template #actions>
            <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
              <Badge v-if="recreateCount" variant="count" data-testid="docker-edit-count-recreate">{{ recreateCount }}</Badge>
              <TooltipIconButton icon="discard" label="Reset" :disabled="!recreateCount" data-testid="docker-edit-reset-recreate" @click="store.reset(containerId, 'recreate')" />
              <Button v-if="!readOnly" size="kira" variant="secondary" :disabled="!canRecreate" data-testid="docker-edit-apply-recreate" @click="confirming = true">
                <CodiconIcon v-if="applying === 'recreate'" name="loading" :size="12" class="codicon-modifier-spin" />Recreate…
              </Button>
            </span>
          </template>
          <EditRecreateSection :draft="draft" :errors="errors" :disabled="readOnly || !!applying" :preserved="base.preserved" />
        </DetailSection>
      </div>
    </div>

    <RecreateConfirmDialog
      v-if="confirming && base"
      :spec="base"
      :changes="changes"
      :busy="!!applying"
      @cancel="confirming = false"
      @confirm="confirmRecreate"
    />
  </div>
</template>
