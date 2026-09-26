# P118 Stream A — findings during final verification

Not one of H1/H2/H3/H7/H8/H10 (Stream A's own mandate) — discovered incidentally by
`bun run test:go`'s full suite, kept here per the working agreement's durability rule rather than
buried in a result section.

## Fixed in this pass

5 `ipcfixture` tests failed with a stale fixture (`ClickHouse`, `Kafka`, `MariaDB`, `MySQL`, `SQS`):
committed `.fixture.ts` missing `caps.keyTypes`, a field some earlier phase's `Caps` struct grew
without regenerating fixtures. Mechanical, safe, in scope (test infra, not app logic) — regenerated
via `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...` +
`bunx biome check --write`. Diff per file: one `keyTypes: false,` line (ClickHouse also picked up a
live container version-string bump, `26.3.32.14` → `26.3.33.24` — expected, captured from the real
container each regen, not hand-edited).

## Flagged, not fixed — real regression, out of Stream A's scope

`TestFixture_Redis` fails for a different reason: `mutate be-delete-ttl: mutate requires a database
path, got: database:db0/namespace:session/key:session%3Aabc`.

Root cause: `689b6eea` (P113 G2, already landed before this phase's base commit) rewrote
`redis/mutate.go`'s `resolveDatabaseSegment` to call `adapters.RequirePath(path, "mutate",
adapters.Seg("database"))`, which requires the path be **exactly** one `database` segment.
The pre-G2 code required only that the path be **database-rooted** — `segments[0].Kind ==
"database"`, any total length:

```go
// before 689b6eea
if len(path.Segments) == 0 || path.Segments[0].Kind != "database" {
    return "", adapters.New(adapters.CodeNotFound, "mutate requires a database-rooted path, got: "+model.EncodePath(path.Segments), nil)
}
```

Redis mutate genuinely receives deeper paths in real use — deleting a namespaced key sends
`database/namespace/key`, per this fixture's own "be-delete-ttl" scenario (`redis_test.go:338-347`)
and `adapterhost.Dispatcher.Mutate` (`data.go:151`), which passes `req.Path` straight through with
no truncation. `RequirePath`'s contract is exact-length by design (`tree.go:70`, doc comment);
it has no rooted/prefix variant. `s3/mutate.go`'s `resolveBucketSegment` uses the same
`RequirePath(..., Seg("bucket"))` call and is fine — s3 mutate paths are always bucket-only, never
deeper — so this is specific to redis's own precondition, not a bug in `RequirePath` itself.

Fix needs one of:
- revert `redis/mutate.go`'s `resolveDatabaseSegment` to the pre-G2 rooted-path check (simplest,
  same shape as before P113), or
- add a rooted-path variant to `RequirePath`/`tree.go` if a future adapter needs the same shape.

Not fixed here: not one of Stream A's named findings (H1/H2/H3/H7/H8/H10), not in Stream A's file
ownership (`redis/mutate.go` isn't in the plan's `{client,adapter,read}.go` list), and picking
between the two fixes above is a real call about `RequirePath`'s own contract — a different
subsystem/design question from this phase's duplication-consolidation mandate. Confirmed pre-existing
and unrelated to any Stream A commit: reproduced byte-identical at base commit `e5e25b0` in a
throwaway worktree, and `git diff --stat e5e25b0..HEAD` from this stream touches no redis file but
`client.go`.

Recommend: a named follow-up phase (`fix(adapters):` scope), or a quick fix folded into whichever
phase next touches `redis/mutate.go`.
