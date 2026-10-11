<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Card } from '@theme/components/ui/card';
import { FieldError } from '@theme/components/ui/field';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import { useCopy } from '@workbench/behaviour/clipboard';
import { computed, ref, watch } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import type { RebaseAct } from '../board/rebaseActions';
import { runStateLabel } from '../runState';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { ACTION_CLASS } from '../tones';
import type { Run } from '../wire';
import AdeRunLog from './AdeRunLog.vue';

// How one run ended: the agent's own report, then what git showed. Used for a branch's last
// rebase and for the report of a failed step run.
const props = defineProps<{
  run: Run;
  title: string;
  /** The rebase acts that can follow it. */
  acts?: readonly RebaseAct[];
  /** Opens the log when a See log click asks for it. */
  listen?: boolean;
}>();

const dialogs = useAdeDialogsStore();
const ui = useAdeBoardUiStore();
const { copy: copyText, copied, error: copyError } = useCopy();
const showLog = ref(false);
watch(
  () => props.listen && ui.focusRebaseLog,
  (want) => {
    if (!want) return;
    showLog.value = true;
    ui.focusRebaseLog = false;
  },
  { immediate: true },
);

const outcome = computed(() => props.run.outcome);
const rebase = computed(() => outcome.value?.rebase ?? null);
const files = computed(() => [
  ...new Set([...(rebase.value?.conflictedFiles ?? []), ...(outcome.value?.report?.conflictedFiles ?? [])]),
]);

const STATE_TONE: Record<string, Tone> = {
  done: 'green',
  failed: 'red',
  stuck: 'red',
  back: 'amber',
  running: 'blue',
  pending: 'grey',
};
const state = computed(() => runStateLabel(props.run.state));

// A step's own result, shown next to the state; the implicit done and failed say nothing more.
const result = computed(() => {
  const id = outcome.value?.result ?? '';
  return id && id !== 'done' && id !== 'failed' ? id : '';
});
const resultTone = computed<Tone>(() => (outcome.value?.status === 'done' ? 'green' : 'red'));
const route = computed(() => {
  const r = outcome.value?.route ?? '';
  switch (r) {
    case '':
    case 'next':
      return '';
    case 'end':
      return t('space.ade.outcome.routeEnd.label');
    case 'stop':
      return t('space.ade.activity.stopped.status');
    case 'retry':
      return `↻ ${props.run.note}`;
    default:
      return r.startsWith('back:') ? `↩ ${props.run.note}` : `→ ${r}`;
  }
});

const endedBy = computed(() => {
  const o = outcome.value;
  if (!o) return '';
  return [
    t(o.reported ? 'space.ade.outcome.endedByReported.label' : 'space.ade.outcome.endedBy.label', {
      source: o.source,
    }),
    ...(rebase.value?.aborted ? [t('space.ade.outcome.aborted.status')] : []),
    ...(rebase.value?.inProgress ? [t('space.ade.outcome.inProgress.status')] : []),
  ].join(' · ');
});

const short = (sha: string): string => sha.slice(0, 7);

function text(): string {
  const o = outcome.value;
  const head = { title: props.title, state: state.value };
  const lines = [
    o?.reason
      ? t('space.ade.outcome.copy.headReason.label', { ...head, reason: o.reason })
      : t('space.ade.outcome.copy.head.label', head),
  ];
  if (o) {
    lines.push(
      t(o.reported ? 'space.ade.outcome.endedByReported.label' : 'space.ade.outcome.endedBy.label', { source: o.source }),
    );
  }
  if (rebase.value) {
    lines.push(
      t(rebase.value.verified ? 'space.ade.outcome.copy.verified.label' : 'space.ade.outcome.copy.notVerified.label'),
    );
    if (rebase.value.aborted) lines.push(t('space.ade.outcome.copy.aborted.body'));
    if (rebase.value.inProgress) lines.push(t('space.ade.outcome.copy.inProgress.body'));
  }
  if (files.value.length) lines.push(t('space.ade.outcome.copy.conflicted.label', { files: files.value.join(', ') }));
  if (o?.report?.lastGitError) lines.push(t('space.ade.outcome.copy.gitError.label', { error: o.report.lastGitError }));
  if (o?.report?.tried) lines.push(t('space.ade.outcome.tried.label', { tried: o.report.tried }));
  for (const b of rebase.value?.branches ?? []) {
    lines.push(
      t(b.onBase ? 'space.ade.outcome.copy.branch.label' : 'space.ade.outcome.copy.branchOffBase.label', {
        name: b.name,
        before: short(b.before),
        after: short(b.after),
      }),
    );
  }
  return lines.join('\n');
}

function copy(): void {
  void copyText(text());
}
</script>

<template>
  <div class="flex flex-col gap-1.5 rounded-kira bg-elevated p-2" data-testid="ade-run-outcome" :data-run-id="run.id">
    <div class="flex items-center gap-2">
      <span class="text-kira-sm text-muted-foreground">{{ title }}</span>
      <AdeChip :label="state" :tone="STATE_TONE[run.state] ?? 'grey'" />
      <span v-if="result" data-testid="ade-outcome-result"><AdeChip :label="result" :tone="resultTone" /></span>
      <span v-if="route" class="text-kira-sm text-muted-foreground" data-testid="ade-outcome-route">{{ route }}</span>
      <AdeChip
        v-if="rebase"
        :label="rebase.verified ? t('space.ade.outcome.verified.status') : t('space.ade.outcome.notVerified.status')"
        :tone="rebase.verified ? 'green' : 'amber'"
      />
      <span class="flex-1" />
      <Button size="kira" variant="ghost" class="text-muted-foreground" data-testid="ade-outcome-copy" @click="copy">
        {{ copied ? t('common.copy.copied.announce') : t('space.ade.outcome.copyForAgent.label') }}
      </Button>
    </div>
    <p v-if="outcome?.reason" class="m-0 text-kira-md" data-testid="ade-outcome-reason">{{ outcome.reason }}</p>
    <p v-if="outcome" class="m-0 text-kira-sm text-subtle" data-testid="ade-outcome-source">
      {{ endedBy }}
    </p>
    <ul v-if="files.length" class="m-0 flex list-none flex-col gap-0.5 p-0 font-data text-kira-sm" data-testid="ade-outcome-files">
      <li v-for="f in files" :key="f" class="truncate text-tone-red">{{ f }}</li>
    </ul>
    <Card v-if="outcome?.report?.lastGitError" data-testid="ade-outcome-git-error">
      <FieldError class="whitespace-pre-wrap font-data">{{ outcome.report.lastGitError }}</FieldError>
    </Card>
    <p v-if="outcome?.report?.tried" class="m-0 text-kira-sm text-muted-foreground" data-testid="ade-outcome-tried">
      {{ t('space.ade.outcome.tried.label', { tried: outcome.report.tried }) }}
    </p>
    <div v-for="b in rebase?.branches ?? []" :key="b.branchId" class="flex items-center gap-1.5 font-data text-kira-sm" data-testid="ade-outcome-branch">
      <span class="min-w-0 truncate">{{ b.name }}</span>
      <span class="text-subtle">{{ short(b.before) }} → {{ short(b.after) }}</span>
      <span v-if="!b.onBase" class="text-tone-amber">{{ t('space.ade.outcome.notOnBase.status') }}</span>
    </div>
    <FieldError v-if="copyError">{{ copyError }}</FieldError>
    <div v-if="acts?.length" class="flex flex-wrap gap-1.5">
      <AdeTip v-for="a in acts" :key="a.id" :parts="a.tip">
        <Button variant="dialog"
          size="kira"
          
          :class="ACTION_CLASS[a.kind === 'abortRebase' ? 'red' : 'amber']"
          :disabled="a.disabled"
          :data-testid="`ade-outcome-act-${a.id}`"
          @click="dialogs.act(a)"
        >
          <VarText :parts="a.label" />
        </Button>
      </AdeTip>
    </div>
    <Button size="kira" variant="ghost" class="self-start text-muted-foreground" data-testid="ade-outcome-log-toggle" @click="showLog = !showLog">
      {{ showLog ? t('space.common.hideLog.label') : t('space.common.showLog.label') }}
    </Button>
    <AdeRunLog v-if="showLog" kind="run" :id="run.id" />
  </div>
</template>
