# P168 Part 4 findings: Studio DB adapters II (document, key-value, stream, object-store)

Plan: `P168-part4-nosql-adapters.md`. Reviewer: one Opus pass, report only.
Base commit: `1a613e6`. HEAD reviewed: `4123010` (plan commit on top of base; no Part 4 code
change between them).

## Checks

Pending (block 7).

## Findings

Ranked high, medium, low within the final list. IDs are stable once committed.

### F1 (low) awscfg: URI with access key but no secret silently uses the ambient credential chain

- `apps/kira-studio/internal/adapters/awscfg/config.go:43-50`
- `u.User` set with a username but no password adds no credentials provider, so
  `LoadDefaultConfig` falls back to env vars, `~/.aws` default profile, SSO or IMDS.
- Scenario: user saves `sqs://AKIAEXAMPLE@us-east-1` and the secret store has no password (never
  entered, or cleared). Connect succeeds with whatever identity the host machine has (e.g. an
  admin default profile), not the key the user named. Browse and writes run as that identity.
- Fix: in URI mode, a non-empty username without a password is a config error
  (`mapConfigError("an access key needs a secret key ...")`); an empty userinfo keeps the default
  chain on purpose.

## Coverage

- Block 1 (awscfg, core callee contract): done. `awscfg/config.go`, `awscfg/errors.go` reviewed
  in full. Core read as callee: `abort.go` (`RunWithAbortRace`: detached ctx, no deadline),
  `tracker.go` (`TrackerFor` no-op release while draining, `Drain` bounded by ctx), `connset.go`
  (`Get` single-flight, eviction `Close` unconditional, `CloseAll`). `url.Parse` error is replaced
  by a fixed message, so the URI (with secret) never reaches error text. `LoadDefaultConfig` with
  an explicit region does no IMDS region probe; credentials resolve lazily on the first request
  under the op ctx. `MapError` passes smithy text verbatim: operation, status, request ID, API
  message; no credential. Endpoint log line (`config.go:74`) logs the option verbatim; userinfo in
  an endpoint URL is not a supported shape, so not reported.
- Block 2 (mongo): not reached.
- Block 3 (redis): not reached.
- Block 4 (kafka): not reached.
- Block 5 (sqs): not reached.
- Block 6 (s3): not reached.
- Block 7 (tests, real-container runs): not reached.
