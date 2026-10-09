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
- F2 (fixed in `fix(gitsession)`): `WorktreeAddPreflight` reports the repo's own checked-out
  branch as clean.
- F3 (fixed in `fix(gitclient)`): a repo deleted while open surfaces a raw `fork/exec` string.
- F4 (no fix): `InstallSemanticModel` downloads through the third-party hub client with a
  hard-coded URL and no env-proxy honoring, so no hermetic offline test exists. The test
  covers the cancelled-context path instead. A URL seam needs `appwire.Options` (Stream C).
- F5 (no fix): a run with `claude` off PATH fails with the shell's own `exec: claude: not found`
  text, no structured message. Test asserts the text names claude.
- Plan correction (Studio): Postman export skips gRPC items (`SkippedGrpc`), so
  `TestMoveRenameGrpcItem` asserts the skip, not an Export/Import round trip of gRPC items.
- Plan correction (Studio): history of tabs not saved in `Tabs` is swept at boot, so
  `TestHistoryClear` saves the surviving tab before the relaunch check.
- Plan correction (Studio): `DataGrip.Scan` reads a project folder (`.idea/dataSources.xml`), not a
  JetBrains config dir; the test scans a copy of the `project-six` fixture.
- F6 (fixed in `fix(datagrip)`): every DataGrip import row failed `E_BAD_REQUEST: invalid MCP
  permission mode`; the importer sent empty MCP modes. Found by the Import step of `TestDataGripScan`.
- F7 (fixed in `fix(grpcclient)`): a reflection deadline surfaced as a raw `DeadlineExceeded`
  transport error when gRPC's timer beat `ctx.Err()`. 41 of ~150 failures under `-race`.
- F8 (fixed in `fix(gitclient)`): `Classify` left `Cause` nil for a cancelled run whose git process
  exited 0, so `errors.Is(err, context.Canceled)` failed and a search cancel read as `E_INTERNAL`.
- Flaky specs: three test-side causes fixed (detail pane still open, host git config leak, build
  charged to the test timeout). `ade-v2-panel.spec.ts:239` did not reproduce in 80 runs; left as is.
