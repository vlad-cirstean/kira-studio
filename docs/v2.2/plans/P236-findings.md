# P236 findings

Plan corrections (not product bugs):

- `review.session.save/.load`, `review.open`, `review.target`, `repo.list`, `graph.revealCommit`,
  `ui.action`, `editor.*`, `link.openExternal`, `pr.openExternal`, `clipboard.write` and the
  `*.changed` pushes are answered by the renderer or VS Code host, not the Go router
  (`gitrpc/handlers.go` serves 56 request names). No Go flow test exists for them. The
  `reviewflow` test covers the router-served `review.*` set instead.
- `graph.revealCommit` and `repo.list` tests dropped for the same reason.
- Credential test drives the ADE board's `Refresh` (fetch), the relay's real caller. A native
  stream push prompts through the stream, not `GitCredential`.

Findings:

- F1 (after landing, needs `apps/kira-space/internal/appwire/appwire.go`, owned by Stream C):
  `GitClientsService.AttachPush`, `GitCredentialService.AttachPush` and
  `MobileAccessService.AttachPush` are exported methods, so Wails binds them. A page can call
  them: a second `MobileAccessService.AttachPush` starts another `RunExpiry` loop and returns a
  detach nobody runs. Fix: package-level funcs (the `docker.CloseWindowBound` precedent), called
  from `appwire`. Coverage gate exempts the three until then.
