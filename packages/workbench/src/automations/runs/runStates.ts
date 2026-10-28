import type { ScriptRun, ScriptRunState } from '@shared/domain/scriptRuns';
import { shallowReactive } from 'vue';

// Run id to state, mirrored from the TanStack run list so non-component readers (a tab's badge)
// stay reactive.
const states = shallowReactive(new Map<string, ScriptRunState>());

const byTerminal = shallowReactive(new Map<string, ScriptRunState>());

export function mirrorRuns(runs: readonly ScriptRun[]): void {
  for (const r of runs) {
    if (states.get(r.id) !== r.state) states.set(r.id, r.state);
    if (r.terminalId !== '' && byTerminal.get(r.terminalId) !== r.state) {
      byTerminal.set(r.terminalId, r.state);
    }
  }
}

/** State of the run a terminal tab carries; the tab id is the terminal id. */
export function terminalRunState(terminalId: string): ScriptRunState | undefined {
  return byTerminal.get(terminalId);
}

export function scriptRunState(runId: string): ScriptRunState | undefined {
  return states.get(runId);
}
