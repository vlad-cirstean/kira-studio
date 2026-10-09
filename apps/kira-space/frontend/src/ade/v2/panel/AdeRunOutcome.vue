<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import VarText from '@theme/components/VarText.vue';
import { copyOrReportError } from '@workbench/util/clipboard';
import { computed, ref, watch } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import type { RebaseAct } from '../board/rebaseActions';
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
const copied = ref(false);
const copyError = ref('');
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
const STATE_LABEL: Record<string, string> = { stuck: 'needs you', back: 'sent back' };
const state = computed(() => STATE_LABEL[props.run.state] ?? props.run.state);

const short = (sha: string): string => sha.slice(0, 7);

function text(): string {
  const o = outcome.value;
  const lines = [`${props.title}: ${state.value}${o?.reason ? `: ${o.reason}` : ''}`];
  if (o) lines.push(`Ended by: ${o.source}${o.reported ? ' (reported by the agent)' : ''}`);
  if (rebase.value) {
    lines.push(`Verified by git: ${rebase.value.verified ? 'yes' : 'no'}`);
    if (rebase.value.aborted) lines.push('The rebase was aborted.');
    if (rebase.value.inProgress) lines.push('A rebase is still in progress in the worktree.');
  }
  if (files.value.length) lines.push(`Conflicted files: ${files.value.join(', ')}`);
  if (o?.report?.lastGitError) lines.push(`Last git error: ${o.report.lastGitError}`);
  if (o?.report?.tried) lines.push(`Tried: ${o.report.tried}`);
  for (const b of rebase.value?.branches ?? []) {
    lines.push(`${b.name}: ${short(b.before)} -> ${short(b.after)}${b.onBase ? '' : ' (not on its base)'}`);
  }
  return lines.join('\n');
}

async function copy(): Promise<void> {
  copyError.value = '';
  await copyOrReportError(
    text(),
    (m) => (copyError.value = m),
    () => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    },
  );
}
</script>

<template>
  <div class="flex flex-col gap-1.5 rounded-kira bg-elevated p-2" data-testid="ade-run-outcome" :data-run-id="run.id">
    <div class="flex items-center gap-2">
      <span class="text-kira-sm text-muted-foreground">{{ title }}</span>
      <AdeChip :label="state" :tone="STATE_TONE[run.state] ?? 'grey'" />
      <AdeChip
        v-if="rebase"
        :label="rebase.verified ? 'verified' : 'not verified'"
        :tone="rebase.verified ? 'green' : 'amber'"
      />
      <span class="flex-1" />
      <Button size="kira" variant="ghost" class="text-muted-foreground" data-testid="ade-outcome-copy" @click="copy">
        {{ copied ? 'Copied' : 'Copy for agent' }}
      </Button>
    </div>
    <p v-if="outcome?.reason" class="m-0 text-kira-md" data-testid="ade-outcome-reason">{{ outcome.reason }}</p>
    <p v-if="outcome" class="m-0 text-kira-sm text-subtle" data-testid="ade-outcome-source">
      ended by {{ outcome.source }}{{ outcome.reported ? ' · reported by the agent' : '' }}
      <template v-if="rebase?.aborted"> · aborted</template>
      <template v-if="rebase?.inProgress"> · rebase still in progress</template>
    </p>
    <ul v-if="files.length" class="m-0 flex list-none flex-col gap-0.5 p-0 font-data text-kira-sm" data-testid="ade-outcome-files">
      <li v-for="f in files" :key="f" class="truncate text-tone-red">{{ f }}</li>
    </ul>
    <pre v-if="outcome?.report?.lastGitError" class="m-0 whitespace-pre-wrap rounded-kira bg-bg px-2 py-1 font-data text-kira-sm text-error" data-testid="ade-outcome-git-error">{{ outcome.report.lastGitError }}</pre>
    <p v-if="outcome?.report?.tried" class="m-0 text-kira-sm text-muted-foreground" data-testid="ade-outcome-tried">
      Tried: {{ outcome.report.tried }}
    </p>
    <div v-for="b in rebase?.branches ?? []" :key="b.branchId" class="flex items-center gap-1.5 font-data text-kira-sm" data-testid="ade-outcome-branch">
      <span class="min-w-0 truncate">{{ b.name }}</span>
      <span class="text-subtle">{{ short(b.before) }} → {{ short(b.after) }}</span>
      <span v-if="!b.onBase" class="text-tone-amber">not on its base</span>
    </div>
    <p v-if="copyError" class="m-0 text-kira-sm text-error">{{ copyError }}</p>
    <div v-if="acts?.length" class="flex flex-wrap gap-1.5">
      <AdeTip v-for="a in acts" :key="a.id" :parts="a.tip">
        <Button
          size="kira"
          class="font-semibold"
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
      {{ showLog ? 'Hide log' : 'Show log' }}
    </Button>
    <AdeRunLog v-if="showLog" kind="run" :id="run.id" />
  </div>
</template>
