## B-1 Per-key terminal writes are unordered concurrent bound calls
- Test: `apps/kira-studio/tests/e2e-real/terminal-real.spec.ts` "keystrokes typed one by one reach the shell in order" (`test.fixme`, "P232 finding B-1")
- Failure: `docker-real` exec typed with `page.keyboard.type('echo kira-$((1+1))')` echoed `echo kir-a$((11+))` and the shell answered `sh: arithmetic syntax error`. Same run shape reorders in the terminal tab (about 2 of 3 runs).
- Repro: server-mode build, Terminal mode, new tab (or Docker container Terminal tab), type a 15+ char line with `keyboard.type`. Go-level `Write` calls issued in order never reorder (termflow/dockerflow pass).
- Suspected cause: `packages/workbench/src/state/createTerminalsStore.ts:218` `writeTerminal` does `void control.terminalWrite(...)` per xterm `onData` chunk with no per-tab queue. Each call is its own concurrent HTTP POST (`/wails/runtime`), handled on separate goroutines, so arrival order is not send order. Same path serves Docker exec (`packages/docker-ui/src/control.ts:103`). Found by reading the console echo and the request log; `codegraph_explore` not needed for the trace.
- Proposed fix: chain writes per terminal id (promise queue in `writeTerminal`, drop on `closeTerminalSession`), or batch chunks inside one microtask tick.
- Class: product bug

## Harness notes (no change made)
- `docker-real` uses `mirror.gcr.io/library/bash:5.2`. With alpine, busybox ash swallowed a lone Enter about 1 run in 3: a cursor-position reply (`ESC[1;5R`) lands in stdin just before it. Test-side workaround, not a product finding. Both specs send the command text as one `insertText` chunk, then Enter, to avoid B-1.
- `not-installed` status class skips here: needs a host without `/var/run/docker.sock`. It runs on a Mac with Docker stopped and no `~/.docker`.
