<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import { computed, ref } from 'vue';
import { useAutomationsModule } from '../automations/module';
import { useRerun } from '../automations/runScript';
import RunElapsed from '../automations/runs/RunElapsed.vue';
import RunOutcomeBlock from '../automations/runs/RunOutcomeBlock.vue';
import RunStatusBadge from '../automations/runs/RunStatusBadge.vue';
import { useScriptRunByTerminal } from '../automations/runs/runsQueries';
// P128 §2.5: the one shared terminal tab view, wrapping TerminalHostView.vue for both apps. A repo
// terminal and a module terminal are the same tab kind, differing only in workspaceId/codeRepoId.
// P242: a script tab also shows its run status strip and, once the run ends, its result block.
import TerminalHostView, { type TerminalHostTabState } from './TerminalHostView.vue';
import { loadTerminalRenderer } from './terminalRendererLoader';

const props = defineProps<{ tab: { id: string; state: TerminalHostTabState } }>();
const ctx = useAutomationsModule();
const run = useScriptRunByTerminal(() => props.tab.id);
const scriptRun = computed(() => (props.tab.state.launchKind === 'script' ? run.value : null));
const ended = computed(() => scriptRun.value !== null && scriptRun.value.state !== 'running');

const rerunRun = useRerun();
const rerunError = ref<string | null>(null);

async function rerun(run: ScriptRun): Promise<void> {
  rerunError.value = await rerunRun(run);
}

async function tail(): Promise<string> {
  return (await loadTerminalRenderer()).tailTerminal(props.tab.id, 40);
}
</script>

<template>
  <TerminalHostView :tab="tab" :deps="ctx.host" :hide-footer="ended">
    <div
      v-if="scriptRun"
      class="flex shrink-0 items-center gap-2 bg-chrome px-1 py-0.5 text-kira-sm"
      data-testid="script-run-strip"
    >
      <RunStatusBadge :state="scriptRun.state" />
      <RunElapsed :run="scriptRun" class="text-muted-foreground" />
    </div>
    <template v-if="scriptRun && ended" #outcome>
      <div class="shrink-0 bg-chrome px-1 py-1" data-testid="script-run-outcome">
        <RunOutcomeBlock
          :run="scriptRun"
          compact
          :tail="tail"
          @rerun="rerun(scriptRun)"
        />
        <span v-if="rerunError" class="text-kira-sm text-error" data-testid="script-run-error">{{ rerunError }}</span>
      </div>
    </template>
  </TerminalHostView>
</template>
