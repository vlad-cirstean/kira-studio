import {
  type ScriptRunTabState,
  scriptRunTabStateSchema,
  type TabScope,
} from '@shared/domain/tabs';
import { parseStateWith, type TabKindDef } from './types';

/** The tab of one smart script run; its badge follows the run's state. `runState` reads the live
 *  run list (automations/runs/runsQueries.ts). */
export function scriptRunTabKind<
  K extends string,
  R extends { kind: string; state: unknown },
  Icon,
  Color,
  Menu,
>(
  mode: TabScope,
  runState: (runId: string) => 'running' | 'done' | 'failed' | 'cancelled' | 'blocked' | undefined,
): TabKindDef<K, R, Icon, Color, Menu> {
  type RunRecord = Extract<R, { kind: K }> & { state: ScriptRunTabState };
  type RunState = Extract<R, { kind: K }>['state'];

  return {
    mode,
    title: (tab) => (tab as RunRecord).state.label || 'Smart script',
    icon: () => 'sparkle' as Icon,
    railColor: () => undefined,
    defaultState: (): RunState => ({ runId: '', label: '' }) as RunState,
    duplicateState: (tab) => ({ ...(tab as RunRecord).state }) as RunState,
    dropResources: () => {},
    menuExtras: () => [],
    badge: (tab) => {
      switch (runState((tab as RunRecord).state.runId)) {
        case 'running':
          return { icon: 'loading', tooltip: 'Running' };
        case 'done':
          return { icon: 'check', tooltip: 'Succeeded' };
        case 'failed':
          return { icon: 'error', tooltip: 'Failed' };
        case 'blocked':
          return { icon: 'warning', tooltip: 'Needs you' };
        default:
          return null;
      }
    },
    parseState: parseStateWith(scriptRunTabStateSchema) as (raw: unknown) => RunState | null,
  };
}
