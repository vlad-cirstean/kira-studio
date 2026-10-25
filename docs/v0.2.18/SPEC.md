# v0.2.18

Not started. First phase `P357` (highest in `docs/HISTORY.md` is `P356`). Branch `chapter/v0.2.18`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P357 | ADE prompt-cache expiry. Show when a session's Claude prompt cache goes cold, for interactive (TUI) and headless resumable sessions. Expiry is the last request timestamp plus the TTL of the last cache write (`usage.cache_creation` `ephemeral_5m`/`ephemeral_1h` in `~/.claude/projects/<cwd-slug>/<agentSessionId>.jsonl`; `ade_sessions` holds `agentSessionId` and `cwd`; `internal/harness/claude/stream.go` drops `usage` today). UI shows warm-until time, cached tokens, cold state. Estimate only: prefix must match and TTL is account-dependent, so read the reported bucket. No automatic keep-warm. | Pending |
