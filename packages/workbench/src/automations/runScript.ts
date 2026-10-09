import type { CustomScript } from '@shared/domain/scripts';
import { useAutomationsModule } from './module';

/** Starts a script in a new terminal tab at its resolved folder. Answers a message when the folder
 *  blocks the run (nothing opens), null on start. */
export function useRunScript(): (script: CustomScript) => Promise<string | null> {
  const ctx = useAutomationsModule();
  return async (script) => {
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
