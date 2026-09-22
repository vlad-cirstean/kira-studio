// P86 §13 — the one earned unit test for this phase's frontend half: reduceAgentActivity is a
// decision structure fed by an out-of-order external producer (each hook is its own `curl`
// process, so a PostToolUse can legitimately arrive before its own PreToolUse), with several
// interacting rules — exactly what CLAUDE.md's narrow unit-test bar names. Pure: (prev, event) =>
// next; the store (state/agentSessions.ts) applies it, this spec calls it directly.
//
// state/agentSessions.ts transitively reaches bridge/control.ts -> '/wails/runtime.js' at module
// scope (bridge/index.ts imports every generated *service.js binding), so this needs the same
// dynamic-import-after-mock pattern document-console-row-menu-lazy-snapshot.spec.ts already uses.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@shared/domain/agent';

const { MAX_RUNNING_TOOLS, reduceAgentActivity } = await import(
  '../../frontend/src/state/agentSessions'
);

function event(partial: Partial<AgentEvent> & { event: string }): AgentEvent {
  return {
    terminalId: 't1',
    sessionId: 's1',
    cwd: '/repo',
    toolName: '',
    toolUseId: '',
    notificationType: '',
    message: '',
    source: '',
    reason: '',
    ...partial,
  };
}

describe('state/agentSessions — reduceAgentActivity (P86 §13)', () => {
  test('1. SessionStart on an existing entry resets rather than merges', () => {
    const busy = reduceAgentActivity(undefined, event({ event: 'PreToolUse', toolUseId: 'a' }));
    expect(busy.runningTools).toEqual(['a']);

    const restarted = reduceAgentActivity(busy, event({ event: 'SessionStart', sessionId: 's2' }));
    expect(restarted).toEqual({
      phase: 'idle',
      runningTools: [],
      toolName: null,
      message: null,
      sessionId: 's2',
    });
  });

  test('2. PreToolUse then PostToolUse for the same tool_use_id leaves runningTools empty, phase still working', () => {
    const started = reduceAgentActivity(
      undefined,
      event({ event: 'PreToolUse', toolUseId: 'a', toolName: 'Bash' }),
    );
    const finished = reduceAgentActivity(started, event({ event: 'PostToolUse', toolUseId: 'a' }));
    expect(finished.runningTools).toEqual([]);
    expect(finished.phase).toBe('working');
  });

  test('3. PostToolUse arriving before its own PreToolUse leaves the set empty, never negative', () => {
    const result = reduceAgentActivity(undefined, event({ event: 'PostToolUse', toolUseId: 'a' }));
    expect(result.runningTools).toEqual([]);
  });

  test('4. an unmatched PostToolUse is a no-op', () => {
    const started = reduceAgentActivity(
      undefined,
      event({ event: 'PreToolUse', toolUseId: 'a', toolName: 'Bash' }),
    );
    const stillRunning = reduceAgentActivity(
      started,
      event({ event: 'PostToolUse', toolUseId: 'b' }),
    );
    expect(stillRunning.runningTools).toEqual(['a']);
  });

  test('5. Notification during a tool call sets attention and keeps runningTools; the following PostToolUse still matches', () => {
    const started = reduceAgentActivity(
      undefined,
      event({ event: 'PreToolUse', toolUseId: 'a', toolName: 'Bash' }),
    );
    const waiting = reduceAgentActivity(
      started,
      event({ event: 'Notification', message: 'May I run this?' }),
    );
    expect(waiting.phase).toBe('attention');
    expect(waiting.message).toBe('May I run this?');
    expect(waiting.runningTools).toEqual(['a']);

    const finished = reduceAgentActivity(waiting, event({ event: 'PostToolUse', toolUseId: 'a' }));
    expect(finished.runningTools).toEqual([]);
  });

  test('6. Stop clears the set, the message and the tool name', () => {
    const started = reduceAgentActivity(
      undefined,
      event({ event: 'PreToolUse', toolUseId: 'a', toolName: 'Bash' }),
    );
    const waiting = reduceAgentActivity(started, event({ event: 'Notification', message: 'hi' }));
    const stopped = reduceAgentActivity(waiting, event({ event: 'Stop' }));
    expect(stopped.phase).toBe('idle');
    expect(stopped.runningTools).toEqual([]);
    expect(stopped.message).toBeNull();
  });

  test('7. runningTools past MAX_RUNNING_TOOLS drops the oldest, not the newest', () => {
    let activity = reduceAgentActivity(undefined, event({ event: 'SessionStart' }));
    for (let i = 0; i < MAX_RUNNING_TOOLS + 5; i++) {
      activity = reduceAgentActivity(activity, event({ event: 'PreToolUse', toolUseId: `t${i}` }));
    }
    expect(activity.runningTools.length).toBe(MAX_RUNNING_TOOLS);
    // The oldest five (t0..t4) are gone; the newest is still present.
    expect(activity.runningTools).not.toContain('t0');
    expect(activity.runningTools).not.toContain('t4');
    expect(activity.runningTools).toContain('t5');
    expect(activity.runningTools[activity.runningTools.length - 1]).toBe(
      `t${MAX_RUNNING_TOOLS + 4}`,
    );
  });
});
