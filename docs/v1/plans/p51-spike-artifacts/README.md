# P51 spike artifacts

Throwaway prototype code backing the measured claims in `../P51-spike-report-part1.md`. Not part
of the app — nothing under `src/` or `tests/` depends on this, and it is not built by the repo's
own toolchain (`bunfig.toml`, `electron.vite.config.ts`, etc. do not reference it).

## `gonode/`

Prototype for §3.3, the Go↔Node engine transport over stdio pipes with length-prefixed JSON
framing. Reproduce the report's numbers:

```
cd gonode
go build -o gonode-bin .
./gonode-bin ./engine_stub.mjs        # ping/echo/event/bulk/error round trips
./gonode-bin ./engine_stub_crash.mjs  # E_ENGINE_DOWN promptness on a mid-call crash
```

Requires a `node` binary on `PATH` and Go ≥ 1.24 (the standalone `go.mod` here is independent of
the app's own Go module, should one exist by the time this is read).
