# Pending CI workflow updates (P57 M7)

This session's GitHub OAuth token lacks the `workflow` scope, so pushing a commit that edits
`.github/workflows/*.yml` was rejected outright ("refusing to allow an OAuth App to create or
update workflow `ci.yml` without `workflow` scope"). Rather than drop the M7 CI changes, the
intended `ci.yml`/`release.yml` content is staged here — copy each file over its counterpart in
`.github/workflows/` and commit from an account/token that has `workflow` scope (reconnect GitHub
with that scope under claude.ai's connector settings, or push from a local checkout).

```sh
cp docs/v1/plans/p57-pending-ci-workflows/ci.yml .github/workflows/ci.yml
cp docs/v1/plans/p57-pending-ci-workflows/release.yml .github/workflows/release.yml
git add .github/workflows/ci.yml .github/workflows/release.yml
git rm -r docs/v1/plans/p57-pending-ci-workflows
git commit -m "ci: apply the P57 M7 workflow updates (Electron removal, Wails bindings, ui/package-smoke jobs)"
```

See `docs/v1/plans/P57-cutover.md`'s M7 entry for what changed and why (§4.14, and the
"CI (§4.14)" paragraph of the M7 write-up) — this README exists only to carry the diff across the
scope gap; it is not new design.
