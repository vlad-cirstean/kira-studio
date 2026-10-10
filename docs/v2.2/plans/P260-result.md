# P260 result

Docker module polish plus Automations row run icon on the right. Design facts: `docs/ARCHITECTURE.md` ("Docker module").

Commits: registry URL (Go, wire, unit test), Studio `LinkService`, registry button, edit tabs,
style group (Compose colour, start/stop colours, no selection bar, ToggleGroup section tabs, `MenuItem.iconClass`),
size in Stats, flow and UI specs, Automations run icon (after P254), docs.

Deviations from the plan:

- Flow test `TestImageRegistryURL` uses a `localhost/` reference for the committed image. The containerd
  image store gives local images a digest too, so "no digest means local" does not hold there. Residual
  gap: an unqualified local name gets a Docker Hub link that may 404.
- `TestOpenExternal` (appflow) and a `Browser` fake in the Studio flow harness added: the coverage check
  requires a flow call for every bound method. Bound count 29 to 30 (harness test, doc).
- Studio `ipcChannels.ts`/`mockRuntime.ts` gain `linkOpenExternal`. UI spec reads the call from `control.log()`.
- Failed recreate remounts the edit view, so the tab returns to In place.
- D10 baselines: Studio automations visual baseline unchanged (dialog and empty state only).
- No `docker-*.json` contract fixture contains images or container detail, so none re-recorded.
- Docker engine for the flow test was already running (not started by this phase, not stopped).
