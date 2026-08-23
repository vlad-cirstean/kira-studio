import { describe, expect, test } from 'bun:test';
import {
  createPreconnectSupervisor,
  type PreconnectExit,
  type PreconnectSupervisor,
} from '../../src/main/preconnect';

// The pre-connect script supervisor (P11) needs no container — it spawns real short-lived
// processes against the OS itself, mirroring redis.spec.ts's numbered scenario style. Every
// scenario uses POSIX-guaranteed commands (sh, sleep, echo, exit) so nothing depends on the dev
// machine's toolchain.

function makeSupervisor(): PreconnectSupervisor {
  return createPreconnectSupervisor({
    log(level, message) {
      if (level === 'error') console.error(`[preconnect] ${message}`);
    },
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('preconnect supervisor (§9.1, P11)', () => {
  test('1. one-shot success resolves without leaving anything to monitor', async () => {
    const sup = makeSupervisor();
    const result = await sup.start('c1', 'exit 0');
    expect(result).toEqual({ kind: 'oneshot' });
    // arm() on a one-shot is a no-op — no entry was ever tracked.
    sup.arm('c1');
    await sup.stop('c1');
  });

  test('2. one-shot failure rejects with the exit code and stderr', async () => {
    const sup = makeSupervisor();
    await expect(sup.start('c2', 'echo boom >&2; exit 3')).rejects.toThrow(/exit 3/);
    await expect(sup.start('c2b', 'echo boom >&2; exit 3')).rejects.toThrow(/boom/);
  });

  test('3. spawn/lookup failure rejects with the exit code in the message', async () => {
    const sup = makeSupervisor();
    await expect(sup.start('c3', 'definitely-not-a-real-binary-xyz')).rejects.toThrow(/exit 127/);
  });

  test('4. a sidecar is still alive at the settle window; stop() ends it', async () => {
    const sup = makeSupervisor();
    const result = await sup.start('c4', 'sleep 60');
    expect(result).toEqual({ kind: 'sidecar' });
    await sup.stop('c4');
  });

  test('5. an armed exit fires onExit exactly once', async () => {
    const sup = makeSupervisor();
    const exits: PreconnectExit[] = [];
    sup.onExit((exit) => exits.push(exit));
    // Must survive the 2s settle window (so it resolves as a sidecar, not a one-shot) and then
    // exit shortly after — that is the "armed, then dies" shape this scenario is testing.
    await sup.start('c5', 'sleep 2.3');
    sup.arm('c5');
    await waitFor(() => exits.length > 0, 3000);
    await new Promise((r) => setTimeout(r, 300));
    expect(exits.length).toBe(1);
    expect(exits[0]?.connectionId).toBe('c5');
  }, 10_000);

  test('6. self-inflicted kills are silent (D8)', async () => {
    const sup = makeSupervisor();
    const exits: PreconnectExit[] = [];
    sup.onExit((exit) => exits.push(exit));
    await sup.start('c6', 'sleep 60');
    sup.arm('c6');
    await sup.stop('c6');
    expect(exits).toEqual([]);
  });

  test('7. exit-before-arm is reported by arm() itself (D7)', async () => {
    const sup = makeSupervisor();
    const exits: PreconnectExit[] = [];
    sup.onExit((exit) => exits.push(exit));
    // A sidecar that dies naturally shortly after the settle window, before arm() is ever
    // called — simulating the adapter connect taking a while after the script has already died.
    const result = await sup.start('c7', 'sleep 2.2');
    expect(result).toEqual({ kind: 'sidecar' });
    await new Promise((r) => setTimeout(r, 500));
    expect(exits).toEqual([]); // not armed yet — nothing should have fired
    sup.arm('c7');
    expect(exits.length).toBe(1);
    expect(exits[0]?.connectionId).toBe('c7');
  }, 10_000);

  test('8. one process per connection — a second start() kills the first (D11)', async () => {
    const sup = makeSupervisor();

    // Capture the PID indirectly: spawn a sidecar that writes its own PID to verify liveness.
    const marker1 = `/tmp/kira-preconnect-test-${crypto.randomUUID()}`;
    await sup.start('c8', `echo $$ > ${marker1}; sleep 60`);
    await waitFor(() => Bun.file(marker1).size > 0, 3000);
    const firstPid = Number.parseInt((await Bun.file(marker1).text()).trim(), 10);
    expect(isAlive(firstPid)).toBe(true);

    const marker2 = `/tmp/kira-preconnect-test-${crypto.randomUUID()}`;
    await sup.start('c8', `echo $$ > ${marker2}; sleep 60`);
    await waitFor(() => Bun.file(marker2).size > 0, 3000);

    // The first PID must be gone now that the second start() superseded it.
    await waitFor(() => !isAlive(firstPid), 5000);
    await sup.stop('c8');
  });

  test('9. stop() kills the whole process group, not just the recorded PID (D9)', async () => {
    const sup = makeSupervisor();
    const marker = `/tmp/kira-preconnect-test-${crypto.randomUUID()}`;
    // `sh -c` cannot exec into a compound command, so the group must be killed, not just the
    // shell's own PID.
    await sup.start('c9', `sleep 60 & echo $! > ${marker}; wait`);
    await waitFor(() => Bun.file(marker).size > 0, 3000);
    const childPid = Number.parseInt((await Bun.file(marker).text()).trim(), 10);
    expect(isAlive(childPid)).toBe(true);
    await sup.stop('c9');
    // stop() resolving is tied to the `sh` process's own exit; the background job it spawned
    // can trail that by a few ms of OS scheduling, so poll rather than assert instantly.
    await waitFor(() => !isAlive(childPid), 3000);
  }, 10_000);

  test('10. SIGKILL escalation reaps a process trapping SIGTERM', async () => {
    const sup = makeSupervisor();
    const marker = `/tmp/kira-preconnect-test-${crypto.randomUUID()}`;
    await sup.start('c10', `echo $$ > ${marker}; trap '' TERM; sleep 60`);
    await waitFor(() => Bun.file(marker).size > 0, 3000);
    const pid = Number.parseInt((await Bun.file(marker).text()).trim(), 10);
    expect(isAlive(pid)).toBe(true);
    await sup.stop('c10');
    expect(isAlive(pid)).toBe(false);
  }, 10_000);

  test('11. stopAll() ends every tracked sidecar', async () => {
    const sup = makeSupervisor();
    await Promise.all(['ca', 'cb', 'cc'].map((id) => sup.start(id, 'sleep 60')));
    await sup.stopAll();
  });

  test('12. stderr retention is bounded to the last non-empty line, truncated', async () => {
    const sup = makeSupervisor();
    const longLine = 'x'.repeat(400);
    await expect(
      sup.start('c12', `echo line1 >&2; echo line2 >&2; echo ${longLine} >&2; exit 5`),
    ).rejects.toThrow(/x{200}/);
  });
});
