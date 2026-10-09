import type { ScriptRun } from '@shared/domain/scriptRuns';
import type { CustomScript } from '@shared/domain/scripts';
import { useAutomationsModule } from './module';
import { useScriptRunDialogStore } from './run/runDialog';

/** Starts a script. A normal script without params opens a terminal tab at its resolved folder; any
 *  other script opens the run dialog, where the person confirms a preview. Answers a message when
 *  the folder blocks the run (nothing opens), null on start. */
export function useRunScript(): (
  script: CustomScript,
  prefill?: Record<string, string[]>,
) => Promise<string | null> {
  const ctx = useAutomationsModule();
  const dialog = useScriptRunDialogStore();
  return async (script, prefill) => {
    if (script.kind === 'smart' || script.params.length > 0) {
      dialog.open({ scriptId: script.id, prefill });
      return null;
    }
    let dir: Awaited<ReturnType<typeof ctx.runs.resolveDir>>;
    try {
      dir = await ctx.runs.resolveDir(script.id);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    if (dir.blocker !== '') return dir.blocker;
    ctx.openTerminalTab({
      cwd: dir.path,
      launch: {
        command: script.command,
        label: script.name,
        color: script.color,
        kind: 'script',
        scriptId: script.id,
      },
    });
    return null;
  };
}

/** Run again: reopens the script with the run's own non-secret params. A multiselect's stored value
 *  is newline-joined. */
export function useRerun(): (run: ScriptRun) => Promise<string | null> {
  const ctx = useAutomationsModule();
  const runScript = useRunScript();
  return async (run) => {
    const script = ctx.scripts.records().find((s) => s.id === run.scriptId);
    if (!script) return 'This script no longer exists.';
    const prefill: Record<string, string[]> = {};
    for (const p of script.params) {
      const was = run.params.find((x) => x.name === p.name);
      if (!was || p.secret) continue;
      prefill[p.name] =
        p.type === 'multiselect' ? was.value.split('\n') : was.value === '' ? [] : [was.value];
    }
    return runScript(script, prefill);
  };
}
