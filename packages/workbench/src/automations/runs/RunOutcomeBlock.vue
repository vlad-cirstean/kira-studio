<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import { Button } from '@theme/components/ui/button';
import { copyOrReportError } from '@workbench/util/clipboard';
import { ref } from 'vue';
import { costText, runReportText } from './runText';

// The run's result: reason, exit code, and the two actions. `tail` supplies the last terminal
// lines for Copy for agent; `compact` drops the detail lines for the terminal tab strip.
const props = defineProps<{
  run: ScriptRun;
  compact?: boolean;
  tail?: () => Promise<string>;
}>();
const emit = defineEmits<{ rerun: [] }>();

const copied = ref(false);
const copyError = ref<string | null>(null);

async function copyForAgent(): Promise<void> {
  copyError.value = null;
  const tail = props.tail ? await props.tail() : '';
  await copyOrReportError(
    runReportText(props.run, tail),
    (m) => {
      copyError.value = m;
    },
    () => {
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1500);
    },
  );
}
</script>

<template>
  <div class="flex flex-col gap-1 text-kira-sm" data-testid="run-outcome">
    <span data-testid="run-outcome-reason">{{ run.outcome?.reason || 'No result yet.' }}</span>
    <span v-if="run.outcome?.summary" data-testid="run-outcome-summary">{{ run.outcome.summary }}</span>
    <span v-if="run.outcome?.costUsd !== undefined" class="text-muted-foreground" data-testid="run-outcome-cost">
      Cost {{ costText(run.outcome.costUsd) }}
    </span>
    <span v-if="run.outcome?.permissionDenials?.length" class="text-muted-foreground" data-testid="run-outcome-denials">
      Denied: {{ run.outcome.permissionDenials.join(', ') }}
    </span>
    <template v-if="!compact">
      <span v-if="run.outcome?.exitCode !== undefined" class="text-muted-foreground" data-testid="run-outcome-exit">
        Exit code {{ run.outcome.exitCode }}
      </span>
      <span v-if="run.outcome?.lastError" class="font-data text-error whitespace-pre-wrap" data-testid="run-outcome-error">
        {{ run.outcome.lastError }}
      </span>
    </template>
    <span v-if="copyError" class="text-error">{{ copyError }}</span>
    <div v-if="run.state !== 'running'" class="flex gap-1">
      <Button variant="dialog" size="kira-lg" data-testid="run-copy" @click="copyForAgent">
        {{ copied ? 'Copied' : 'Copy for agent' }}
      </Button>
      <Button v-if="run.scriptId" variant="dialog" size="kira-lg" data-testid="run-again" @click="emit('rerun')">
        Run again
      </Button>
    </div>
  </div>
</template>
