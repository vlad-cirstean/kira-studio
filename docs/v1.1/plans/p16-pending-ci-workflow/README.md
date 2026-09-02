# P16's pending CI workflow

`db-compat.yml` here is the real, finished `workflow_dispatch`-only GitHub Actions workflow for
P16's on-demand DB compatibility suite (`docs/v1.1/plans/P16-db-compat-suite.md` §5 C4) — it just
isn't live in `.github/workflows/` yet.

GitHub refuses to accept a commit touching `.github/workflows/*.yml` from this session's OAuth
credential: "refusing to allow an OAuth App to create or update workflow `db-compat.yml` without
`workflow` scope." A session whose GitHub credential carries the `workflow` scope can apply it —
`git mv docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml .github/workflows/db-compat.yml`,
delete this README, commit, push. No other change is needed; the file is otherwise final.

This is the same restriction `AGENTS.md`'s "Known open items" previously tracked for the P58 CI
workflows (resolved once a session with `workflow` scope applied them) — same shape, new file.
