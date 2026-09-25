import { type TabScope, type TerminalTabState, terminalTabStateSchema } from '@shared/domain/tabs';
import { parseStateWith, type TabKindDef } from './types';

// A filesystem basename (state.cwd is an absolute path, not an encoded NodePath).
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** P113 F6: kira-space's and kira-studio's own `state/tabKinds.ts` each carried this terminal
 *  descriptor byte-identical apart from their own mode constant. `Icon`/`Color`/`Menu` stay each
 *  app's own type parameters (`types.ts`'s own header comment explains why they genuinely differ)
 *  — this factory's own values (a literal icon string, a `TerminalTabState['color']`, an empty
 *  menu array) are valid members of every real instantiation, so the `as Icon`/`as Color` casts
 *  below assert what each call site's own type arguments already guarantee, mirroring the
 *  `tab as TerminalTabRecord` cast the original per-app code used for the same reason (`title`/
 *  `railColor` take the whole tab-record union `R`, not the narrowed terminal member). Callers
 *  supply their own `dropResources` since it reaches into an app-local `useTerminalsStore()`. */
export function terminalTabKind<
  K extends string,
  R extends { kind: string; state: unknown },
  Icon,
  Color,
  Menu,
>(mode: TabScope, dropResources: (tabId: string) => void): TabKindDef<K, R, Icon, Color, Menu> {
  type TerminalRecord = Extract<R, { kind: K }> & { state: TerminalTabState };
  type TerminalState = Extract<R, { kind: K }>['state'];

  return {
    mode,
    title: (tab) => {
      const s = (tab as TerminalRecord).state;
      return s.label || basename(s.cwd) || 'Terminal';
    },
    // 'terminal-bash', not 'terminal': the 'console' kind (a SQL console) already owns that glyph.
    // The launch kind shows in the title and the rail colour, not a second icon vocabulary.
    icon: () => 'terminal-bash' as Icon,
    railColor: (tab) => (tab as TerminalRecord).state.color as Color,
    defaultState: (): TerminalState =>
      ({
        cwd: '',
        codeRepoId: '',
        command: '',
        label: '',
        color: 'none',
        launchKind: 'shell',
      }) as TerminalState,
    // Copying the cwd (and command/label/color) means "Duplicate tab" on a terminal opens a
    // second session with the same launch — which needs no special case.
    duplicateState: (tab) => ({ ...(tab as TerminalRecord).state }) as TerminalState,
    // The one place a PTY dies on close — blind-called for every kind (dropPageStoresForTab), so
    // a non-terminal tab id is a registry miss here, not a branch.
    dropResources,
    menuExtras: () => [],
    parseState: parseStateWith(terminalTabStateSchema) as (raw: unknown) => TerminalState | null,
  };
}
