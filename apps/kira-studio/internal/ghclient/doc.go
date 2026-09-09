// Package ghclient is G24's whole GitHub surface (docs/v1.3/SPEC.md §3.5, `:70`'s own package
// row): a Go wrapper around the user's own `gh` CLI, spawned exactly like internal/gitclient spawns
// `git` — argv only, no shell, ever — but through its own Runner/Discovery/Client, never gitclient's
// (F5: gitclient.Runner hard-prepends git-only `-c` overrides and always appends `--no-pager`, both
// of which `gh` rejects outright).
//
// This package owns NO credential of any kind. It never sets, reads, or logs GH_TOKEN or
// GITHUB_TOKEN — every environment variable this package's Runner appends is named in runner.go's
// own ghHygieneEnv table, and neither of those two names is anywhere in it. Whatever `gh auth`
// state the user's own machine already has is what every call here rides on, exactly as SPEC §3.5
// requires ("delegate entirely to the `gh` CLI already on the user's machine, own no credentials of
// any kind").
//
// D3's three departures from gitclient/discovery.go's own template:
//   - Probe order: PATH -> /opt/homebrew/bin/gh -> /usr/local/bin/gh. No Xcode Command Line Tools
//     shim gate — `gh` has no analogue to git's own CLT-shim trap.
//   - No configured path: there is no `gh.path` setting (§10.6) — `gh` is optional, not mandatory,
//     so an inert feature is the designed failure mode, not a footgun to route around.
//   - No version floor: every `gh api`/`gh auth status` call this package makes has been stable
//     since `gh` 1.0, so there is no RequiredVersion/tooOld kind to enforce.
//
// `gh` is not installed in this development container (F13) — every test in this package drives a
// fake Locator/Runner/Clock, exactly as gitclient/discovery_test.go already does for git, so
// `go test ./...` is green with no real `gh` anywhere on the machine running it.
package ghclient
