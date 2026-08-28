# Kira Studio Shell

The Wails v3 (Go) native shell being built to replace Electron's `src/main`/`src/preload`, per
[`docs/v1/plans/P52-wails-go-migration.md`](../docs/v1/plans/P52-wails-go-migration.md) (built on
the spike in [`docs/v1/plans/P51-wails-go-node-engine-spike.md`](../docs/v1/plans/P51-wails-go-node-engine-spike.md)).

Not standalone: it embeds `frontend/dist`, built from the real `src/renderer` by the repo root's
`bun run build:wails` (see `../vite.wails.config.ts`) — build that first. From the repo root:

```
bun run build:wails        # builds src/renderer into shell/frontend/dist
sh scripts/vendor-node.sh  # vendors a trimmed Node runtime into shell/runtime/node
cd shell
wails3 generate bindings -b -i -ts
go run .
```

`shell/blank/` and `shell/cmd/g1measure/` are P52 gate-G1 measurement scaffolding
(`docs/PERF.md` §2.3), not part of the shipped app.
