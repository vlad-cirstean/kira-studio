# P125 — Root README refresh

Content edit, one file. User authorized plan and rewrite in one Opus pass, no separate implementer.
Root `README.md` exempt from `CLAUDE.md`'s terse style, so rewrite is normal prose; this doc is not.

## Problem

Old README (450 lines, base `88943a7a`) read as internal engineering reference, not entry point:

- **Status** narrated every chapter v1.1-v1.9 inline (Kira Version, v1.5 code intelligence, v1.6
  git mode, v1.8 blame...), mostly about features no longer in this app since P100.
- **Supported engines**: 9-column capability matrix plus 4 footnotes on driver internals
  (`caching_sha2_password` RSA handshake, `sqlite3_interrupt` via per-op `*sql.Conn`, ClickHouse's
  `JSONCompactStringsEachRowWithNamesAndTypes` client, P58b M6.4).
- **Development**: 22-row table explaining every bun script, including `typecheck` split internals
  and `test:e2e-real` launch mechanics.
- **Tests**: separate section per tier, duplicating Development table.
- **Architecture**: 21-line directory listing down to `tests/` subdirs, then chapter-by-chapter
  SPEC link paragraph.
- **Documentation**: v1 through v1.9 walked one by one, `docs/ARCHITECTURE.md` listed twice.
- **Stale facts**: Settings' Appearance listed "commit date format", Advanced listed "git log
  level" — both moved to Kira Space or renamed by P120 (`advanced.logLevel`). DataGrip import
  (`internal/datagrip`, `DataGripImportDialog.vue`) shipped but went unmentioned.

## Change

Keep what a reader deciding to install needs; link out the rest.

- **Intro**: what app is, plus one paragraph naming Kira Space and pointing at
  `apps/kira-space/README.md` (checked: exists, current, P100-accurate).
- **Status**: 4 short bullets — beta, platform (`LSMinimumSystemVersion` 14.0.0, arm64, dark
  only), ad-hoc signing plus Keychain prompt, Keychain credentials. No chapter history.
- **Install**: kept `scripts/install.sh` one-liner (exists) and build-from-source; real clone URL
  instead of `<repo-url>`.
- **Engines**: matrix cut to Engine / Default view / Query console / Writes, no footnotes. Pagination,
  count, EXPLAIN, cancel already live in `docs/ARCHITECTURE.md` Per-database mapping; driver quirks
  in Per-engine adapter facts — link there. MySQL 8.0.16 floor kept inline, user-relevant.
- **Features**: Studio / Api / Database MCP lists kept, each bullet shortened. Settings reduced to
  section names (8 panes under `workbench/settings/`). DataGrip import added.
- **Requirements**: kept — `apps/kira-space/README.md` points at it.
- **Development**: 2 commands plus 5 most-used scripts. Full list is `package.json` itself; test
  tiers in `docs/ARCHITECTURE.md` Testing; sandbox quirks in `docs/DEV_ENVIRONMENT.md`. Kept
  `setup`/`lint`/`typecheck`/`test:go` since Kira Space README cites root Development for them.
  No new contributor doc (none exists; not invented).
- **Tests**: folded into Development.
- **Architecture**: one paragraph plus 6-line top-level layout.
- **Documentation**: 5 entries — ARCHITECTURE, PACKAGING, DEV_ENVIRONMENT, `docs/v1.9/`, CLAUDE.md.
- **Not shipped**: kept, checked against source — no SSH tunnel (DataGrip import drops one with
  `ssh-tunnel-dropped`), no file export (only clipboard Copy as JSON), no light theme. Dropped
  "planned for v2" (no spec backs it) and write-model recap (now in Features).
- **License**: unchanged.

## Verification

- `bun run lint` clean.
- `git diff --stat` touches only `README.md`, this file, `docs/v1.9/SPEC.md`.
- Every relative link in new README resolves to an existing path.
