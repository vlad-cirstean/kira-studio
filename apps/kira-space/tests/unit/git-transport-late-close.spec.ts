// P108 Part 20 F3 — transport.ts's createNativeGitTransport used to delete
// sharedClientsByCodeRepoId's own entry unconditionally on the channel's onClose. But onClose
// fires asynchronously — from the socket's own close event, strictly after channel.close()
// returns (streamChannel.ts's own fireClose/onclose wiring) — so disposeGitTransport(id) followed
// by a same-tick gitTransportFor(id) (collapse/re-expand a worktree, or close/reopen a workspace)
// installs a NEW shared client before the stale close lands. The old code then deleted that NEW,
// live entry instead of the dead one: it stayed open (socket, Go gitsession.Conn, repo hold) but
// unreachable from the map for the rest of the window's life.
//
// The shared `/wails/runtime.js` test double (wailsRuntime.ts) memoizes one socket per stream
// name for the whole process — correct for the real singleton 'engine' stream, but it means this
// spec cannot model two independent 'git' sockets the way production does. Instead of fighting
// that, this test captures each client's own close trigger (the function `createStreamChannel`
// assigns to `socket.onclose`) the moment it's installed, then invokes the STALE one by hand,
// well after a newer client has replaced it — reproducing the exact interleaving the bug depends
// on without needing two real sockets.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { getStream } from '@workbench/testing/unit/wailsRuntime';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { gitTransportFor, disposeGitTransport } = await import(
  '../../frontend/src/repo/git/transport'
);

describe('P108 Part 20 F3: transport.ts stale onClose vs. a newer shared client', () => {
  test('a stale close from a disposed client does not evict the newer client for the same codeRepoId', () => {
    const codeRepoId = 'race-repo-f3';
    const socket = getStream('git');
    const realClose = socket.close.bind(socket);
    // This test drives "the close event lands" by hand (see header comment) — the real close
    // plumbing is irrelevant to what it asserts.
    socket.close = () => {};

    gitTransportFor(codeRepoId); // shared client A
    const closeA = socket.onclose;
    expect(typeof closeA).toBe('function');

    disposeGitTransport(codeRepoId); // A dropped from the map; socket.close() above is a no-op
    gitTransportFor(codeRepoId); // shared client B, for the same codeRepoId
    const closeB = socket.onclose;
    expect(closeB).not.toBe(closeA); // a genuinely new channel was created for B

    // A's real close event lands now, strictly after B replaced it in the map — F3's own race.
    closeA?.();

    // Fixed: B is still the cached client, so this next call is a cache hit — no new channel is
    // created, socket.onclose is untouched. Buggy (unconditional delete): A's stale close would
    // have evicted B too, so this would create a THIRD client and reassign socket.onclose again.
    gitTransportFor(codeRepoId);
    expect(socket.onclose).toBe(closeB);

    // Cleanup — socket.close() stays the no-op here: the shared fake socket refires 'close'
    // unconditionally on every close() call (a real socket does not, once already closed), so
    // restoring the real one before disposing B would recurse through its own onClose handler.
    // Orthogonal to F3 itself; keeping the no-op in place for this one teardown call sidesteps it.
    disposeGitTransport(codeRepoId);
    socket.close = realClose;
  });
});
