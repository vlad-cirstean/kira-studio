import type { AgentEvent } from '@shared/domain/agent';

// P129 Part 4 §0.15: completion detection for a delivered prompt. Both hook facts are Part 1's own
// (§4.8): `UserPromptSubmit` starts every user turn; `Stop` ends it, even when a wake tool leaves
// the session `waiting`. Pure — no Vue, no clock read; `installAdeSignals` feeds `onEvent` from its
// existing `onAgentEvent` subscription, and `adeActions`' own `watch` on the agent store's
// `sessions` feeds `onLive`.

export type TurnOutcome = 'stop' | 'ended';

export interface TurnWatch {
  done: Promise<TurnOutcome>;
  /** Detaches with no resolution — used when a delivery itself fails before any turn could start. */
  cancel: () => void;
}

interface WatchEntry {
  terminalId: string;
  /** Send-to-a-running-session arms before `Send`, `true`: a `Stop` from the turn already running
   *  (before *this* prompt's own `UserPromptSubmit`) is ignored. A launch arms `false`: the first
   *  `Stop` is the turn the launch's own prompt started. */
  submitted: boolean;
  liveSeen: boolean;
  resolve: (outcome: TurnOutcome) => void;
}

export function createTurnWatcher(): {
  watch: (terminalId: string, opts: { requireSubmit: boolean }) => TurnWatch;
  onEvent: (event: AgentEvent) => void;
  onLive: (terminalIds: readonly string[]) => void;
} {
  const watches = new Map<number, WatchEntry>();
  let nextId = 0;

  function watch(terminalId: string, opts: { requireSubmit: boolean }): TurnWatch {
    const id = nextId++;
    let resolveFn: (outcome: TurnOutcome) => void = () => {};
    const done = new Promise<TurnOutcome>((resolve) => {
      resolveFn = resolve;
    });
    watches.set(id, {
      terminalId,
      submitted: !opts.requireSubmit,
      liveSeen: false,
      resolve: resolveFn,
    });
    return {
      done,
      cancel: () => {
        watches.delete(id);
      },
    };
  }

  function onEvent(event: AgentEvent): void {
    for (const [id, entry] of watches) {
      if (entry.terminalId !== event.terminalId) continue;
      if (event.event === 'UserPromptSubmit') {
        entry.submitted = true;
      } else if (event.event === 'Stop') {
        if (entry.submitted) {
          entry.resolve('stop');
          watches.delete(id);
        }
      } else if (event.event === 'SessionEnd') {
        entry.resolve('ended');
        watches.delete(id);
      }
    }
  }

  /** A launch not yet listed among live terminal ids is not counted `ended` — only a terminal seen
   *  live at least once, then absent, resolves `ended` (a launch's own PTY needs a moment to
   *  register). */
  function onLive(terminalIds: readonly string[]): void {
    const live = new Set(terminalIds);
    for (const [id, entry] of watches) {
      if (live.has(entry.terminalId)) {
        entry.liveSeen = true;
      } else if (entry.liveSeen) {
        entry.resolve('ended');
        watches.delete(id);
      }
    }
  }

  return { watch, onEvent, onLive };
}

/** The one instance every renderer flow shares (§0.15). */
export const adeTurns = createTurnWatcher();
