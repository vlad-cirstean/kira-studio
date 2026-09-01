# Kira Studio

The Wails v3 (Go) native app — every database driver runs in-process here, alongside windowing,
IPC, SQLite storage and the op log. Originally scaffolded per
[`docs/v1/plans/P52-wails-go-migration.md`](../../docs/v1/plans/P52-wails-go-migration.md) (built on
the spike in [`docs/v1/plans/P51-wails-go-node-engine-spike.md`](../../docs/v1/plans/P51-wails-go-node-engine-spike.md));
see [`docs/v1/plans/P58f-cutover.md`](../../docs/v1/plans/P58f-cutover.md) for the later cutover that
removed the Node engine sidecar those two plans still describe.

Not standalone: it embeds `frontend/dist`, built from the real `frontend/src` by the repo root's
`bun run build` (see `frontend/vite.config.ts`) — build that first. From the repo root:

```
bun run build                          # builds frontend/src into apps/kira-studio/frontend/dist
cd apps/kira-studio
wails3 task common:generate:bindings
go run .
```

`blank/` and `cmd/g1measure/` are P52 gate-G1 measurement scaffolding
(`docs/PERF.md` §2.3), not part of the shipped app.
