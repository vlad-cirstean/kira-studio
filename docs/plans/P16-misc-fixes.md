# P16 — Misc fixes: preconnect-mode checkbox, kind icon picker, error popover, demo-db coverage, font bugs

> Not a SPEC.md §10 deliverable line — P16 is a grab-bag of user-directed fixes and small UX
> improvements requested after P15 shipped, grouped into one phase rather than reopening P1, P9,
> P10, P11 or P14 to carry them individually. Added to the phasing table (§10) purely as a
> historical record of what shipped and when, the same way P13's "nonfunctional sweep" row exists
> despite not mapping to one original spec sentence.

## 1. What's in this phase

1. **Preconnect script mode is now an explicit per-connection checkbox** — overrides P11 §D5's
   "no per-connection configuration" decision. §2.
2. **Connection-kind picker in the dialog is now a row of per-kind icons**, replacing the `<select>`
   dropdown. §3.
3. **Connection tree errors get a click-to-open popover** (full text, scrollable, copyable)
   instead of a truncated span with no way to read the rest. §4.
4. **`scripts/demo-dbs/` now covers all six supported engines** (Kafka, SQS were missing), documents
   every service's credentials inline, and seeds a 20k-message Kafka topic alongside the existing
   small one. §5.
5. **Two font-family settings bugs fixed** — the Settings dialog font field and one orphaned CSS
   variable in the console's document view. §6.
6. **Testcontainers preset packages replace `GenericContainer`** for Postgres, MariaDB, Redis.
   Mongo is deliberately excluded. §7.
7. **Two small papercuts**: tree-expand on a disconnected connection now connects first instead of
   erroring; operations-panel rows are text-selectable. §8.

---

## 2. Preconnect sidecar checkbox (overrides P11 §D5)

P11 shipped a settle-window heuristic (`PRECONNECT_SETTLE_MS = 2000`): if a pre-connect script is
still running 2s after launch, it's treated as a long-lived sidecar and armed to drop the
connection on exit; if it already exited cleanly, it's treated as one-shot prep and never
monitored. §D5 of that plan explicitly chose not to expose this as configuration.

That heuristic has a real failure mode: a one-shot script that just happens to take longer than 2s
(a slow `pg_isready` wait, a cold-starting tunnel) gets auto-promoted to "sidecar" and the
connection drops the moment it exits — even though the user never intended it to be monitored.
Conversely a script the user *does* want monitored (a `kubectl port-forward`) only gets armed if it
happens to still be alive at the 2s mark, which is a race, not a contract.

**Decision (D1): add an explicit checkbox, confirmed with the user over the settle-window
auto-detection.** The checkbox lives in `ConnectionDialog.vue`, conditional on a script being
present:

> "Keep it running, disconnect if it dies" — off by default (matches every existing connection's
> prior behavior unmodified).

The settle-window race in `preconnect.ts`'s `start()` is untouched — `arm()` is still what actually
enables the exit → disconnect behavior, and a supervisor entry can still resolve as `'oneshot'` or
`'sidecar'` internally. What changed is the *caller*: `connections.ts`'s `doConnect()` no longer
derives its `arm()` decision from `start()`'s return value. It now calls `arm()` whenever the new
`preconnectSidecar` field is `true`, full stop — a no-op if the script already exited by the time
`arm()` runs (nothing left in the supervisor's map).

**Storage/schema:** `preconnectSidecar: boolean` (`.default(false)`), migration
`0004_misc_fixes.sql` adds `preconnect_sidecar INTEGER NOT NULL DEFAULT 0`, so every existing row
keeps its current (unmonitored, "run each time") behavior after upgrade. `ResolvedConnectionConfig`
strips it the same way it already strips `preconnect` (D13's engine-boundary rule).

**Tests:** `preconnect.spec.ts`'s two connect-flow object literals now set the field explicitly —
`true` for "Sidecar PG" (the `sleep 600` case, which still needs its exit to drop the connection)
and `false` for "OneShot PG" (whose clean exit must still leave the connection up). Every other
`ConnectionInput`-typed literal across `tests/ui/*.spec.ts` (≈17 files) got `preconnectSidecar:
false` next to its existing `preconnect: null`.

---

## 3. Connection-kind icon picker

The create/edit dialog's "Kind" field was a plain `<select>`. Confirmed with the user: replace it
with a row of clickable per-kind icon buttons — same interaction shape as `ColorPicker.vue`'s swatch
row (`role="radiogroup"`, one `role="radio"` button per option, `.selected` for the current value).

**D2 — icons are chosen for shape distinctiveness, not brand identity.** The codicon set
(`@vscode/codicons`) has no vendor logos, so `connectionKindIcon()` (new, in `icons.ts`) maps each
`ConnectionKind` to an existing codicon: `postgres → database`, `mariadb → server-environment`,
`mongodb → json`, `redis → symbol-key`, `kafka → broadcast`, `sqs → inbox`, `s3 → archive`. This is
a separate table from `icons.ts`'s existing `KIND_ICON` (tree-node kinds, not connection kinds) —
different domain, kept as a second exported function rather than overloading one map.

Disabled (not-yet-supported) kinds keep their disabled state and title text; `onKindChange()` is
unchanged (still guards on `SUPPORTED_KINDS`). No test referenced the old `[data-testid="connection-kind"]`
`<select>` via `selectOption`, so the swap was safe to make without touching any spec; the container
keeps that testid and each button additionally carries `connection-kind-${kind}`.

---

## 4. Connection-error popover

`TreeRow.vue`'s connection-error display (`row.error`, sourced from `treeState.errors`) was a
`text-overflow: ellipsis` span with **no `title` attribute at all** — a long adapter error (a
Postgres error message, a timeout detail) was truncated and there was no way to read the rest of it
short of widening the sidebar panel.

**D4 — new `ErrorPopover.vue`, not a native `title` tooltip.** A native tooltip is unreadable for
anything beyond one short line, isn't reachable on touch, and can't be copied without first
widening a panel. `ErrorPopover.vue` mirrors `ContextMenu.vue`'s existing pattern (`Teleport` to
`body`, `position: fixed`, positioned off the trigger's bounding rect, closed on outside
`mousedown` or `Escape`): a small error-icon trigger showing the same truncated text, and on click a
scrollable panel with the full message (`white-space: pre-wrap`) plus **Copy** (reusing
`clipboard.ts`'s `copyText()`) and **Close** buttons.

`OperationsPanel.vue`'s error display was deliberately **left alone** — it already has a
click-to-expand detail row (`kind: 'detail-error'`) that renders the full error in a
`CodeMirrorHost`, so it never had the "truncated with no escape hatch" problem `TreeRow.vue` did.
`.status-dot`'s native `title` tooltip (server version, or the same error string, on the connection
row's status indicator) is also left as-is — same known limitation, but out of scope here; a
follow-up could route it through the same popover if it comes up again.

---

## 5. `scripts/demo-dbs/` — full six-engine coverage

Previously covered Postgres, MariaDB, MongoDB, Redis only. Added:

- **`kafka` and `sqs` services** in `docker-compose.yml`, matching the images/mode already
  standardized on for the automated test harness (`confluentinc/cp-kafka:7.6.1` KRaft single-node,
  `localstack/localstack:3` with `SERVICES=sqs` — see `tests/db/support/kafka.ts` / `sqs.ts`).
- **`scripts/demo-dbs/kafka/seed.sh` and `scripts/demo-dbs/sqs/seed.sh`** — shell scripts run via
  `docker exec -i <container> bash < seed.sh`, using each image's bundled CLI (`kafka-topics` /
  `kafka-console-producer` / `kafka-console-consumer`; `awslocal`) rather than adding a
  kafkajs/AWS-SDK dependency to a dev-only script.
- **Every service's connection string/credentials as an inline comment** directly above its
  compose block (e.g. `# postgresql://kira:kira@localhost:5432/kira`), so the file is self-
  documenting without cross-referencing the README.
- **`large-topic`** (D6): 4 partitions, 20,000 keyed JSON messages, alongside the existing `orders`
  (6 messages) and `empty-topic` (0 messages) — the same ~20k scale already used by the
  relational/document seeds' `orders` table, so the Kafka tree/stream view has something to
  paginate against instead of only toy-sized topics. Generated via `kafka-console-producer` fed
  from a single `awk`-piped stream (one producer process, not one exec per message) — seeding takes
  under 10s. Verified live: `GetOffsetShell` reports the four partitions summing to exactly 20,000.
- **`empty-queue`, `orders-queue` (5), `drain-queue` (7)** for SQS — unchanged from the prior
  session's addition, listed here for completeness of the file inventory in §9.

**D5 — the Kafka/SQS seeds are not idempotent the same way the relational seeds are.** Topics/
queues use `--if-not-exists`/reuse, but re-running `seed.sh` appends another batch of messages on
top of whatever's there (no primary key to dedupe against). Documented in the README rather than
solved — solving it would mean tracking seed state somewhere, which is disproportionate for a dev
fixture.

---

## 6. Font-family settings bugs

Two independent, previously-undiagnosed bugs, both fixed:

1. **`SettingsDialog.vue`'s font-family `<input>` only committed on `change`** (blur-triggered).
   Pressing Escape to close the dialog — the natural way to dismiss it — fires a `keydown` handler
   that closes the dialog immediately, before an unblurred `change` ever fires, so a typed font
   name was silently discarded. Fixed by switching to `@input` (fires live, on every keystroke),
   matching how `patchSettings()` already applies appearance optimistically.
2. **`ConsoleResultGrid.vue`'s document-mode result text referenced `--kira-font-family-mono`**,
   a CSS custom property set nowhere in the codebase — confirmed via a repo-wide grep with no
   exclusions (an earlier `\b`-bounded exclusion pattern had been silently swallowing this exact
   line and almost hid the bug). That view always rendered the literal fallback (`monospace`),
   never following the Settings font. Fixed by pointing it at `--kira-font-family`, the same
   variable every other font-following element in the app uses.

---

## 7. Testcontainers preset packages

`tests/db/support/postgres.ts`, `mariadb.ts`, `redis.ts` swapped `GenericContainer` for
`@testcontainers/postgresql`'s `PostgreSqlContainer`, `@testcontainers/mariadb`'s
`MariaDbContainer`, and `@testcontainers/redis`'s `RedisContainer` respectively — each preset
package ships its own wait strategy tuned for that engine (e.g. Postgres's healthcheck-based wait
replaces the old `Wait.forLogMessage(..., 2)` double-boot workaround) instead of this repo hand-
rolling one per engine.

**D3 — MongoDB is deliberately excluded.** `@testcontainers/mongodb`'s preset forces
`--replSet rs0` unconditionally (Mongo's driver needs a replica set for certain features the
preset assumes every caller wants), which this app's single-node dev/test Mongo instance does not
need and would add unrelated startup complexity to accommodate. `tests/db/support/mongo.ts` keeps
using `GenericContainer`.

`package.json` gains `@testcontainers/mariadb`, `@testcontainers/postgresql`,
`@testcontainers/redis` (all `12.1.0`, matching the already-present `@testcontainers/kafka` /
`@testcontainers/localstack` versions).

---

## 8. Two small papercuts

- **`state/tree.ts`'s `expand()`** now connects a disconnected connection first (rather than
  surfacing `E_DISCONNECTED`) when its tree node is expanded — the twisty is the primary way users
  browse, so it shouldn't require a separate explicit "Connect" click first. Loading state is
  tracked through the connect attempt so the row's spinner reflects it.
- **`OperationsPanel.vue`'s `.ops-row`** gained `user-select: text` — operation/error rows were not
  selectable for manual copy before this (only the `[data-testid="copy-error"]` menu item worked).

---

## 9. File list

| Path | Action | Why |
|---|---|---|
| `src/shared/domain/connection.ts` | MOD | `preconnectSidecar` field (§2) |
| `src/shared/protocol/engine-ops.ts` | MOD | strip `preconnectSidecar` from `ResolvedConnectionConfig` (§2) |
| `src/main/storage/schema/connections.ts` | MOD | `preconnect_sidecar` column (§2) |
| `src/main/storage/migrations/0004_misc_fixes.sql` | **NEW** | the migration (§2) |
| `src/main/storage/migrations/index.ts` | MOD | registers migration 4 |
| `src/main/storage/repos/connections.ts` | MOD | 4 touch points: select, row schema, insert, update (§2) |
| `src/main/connections.ts` | MOD | `resolve()`/`resolveFromInput()`/`doConnect()` gate `arm()` on the field (§2) |
| `src/renderer/state/connections.ts` | MOD | `defaultDraft()` includes the field (§2) |
| `src/renderer/project/ConnectionDialog.vue` | MOD | sidecar checkbox (§2) + kind icon picker (§3) |
| `src/renderer/project/icons.ts` | MOD | `connectionKindIcon()` (§3) |
| `src/renderer/project/ErrorPopover.vue` | **NEW** | click-to-open error display (§4) |
| `src/renderer/project/TreeRow.vue` | MOD | uses `ErrorPopover` (§4) |
| `src/renderer/project/state/tree.ts` | MOD | connect-on-expand (§8) |
| `src/renderer/workbench/panels/OperationsPanel.vue` | MOD | `user-select: text` (§8) |
| `src/renderer/workbench/SettingsDialog.vue` | MOD | font input `@change` → `@input` (§6) |
| `src/renderer/views/console/ConsoleResultGrid.vue` | MOD | orphaned CSS var fixed (§6) |
| `scripts/demo-dbs/docker-compose.yml` | MOD | Kafka/SQS services, credential comments (§5) |
| `scripts/demo-dbs/kafka/seed.sh` | **NEW** | topics + messages incl. `large-topic` (§5) |
| `scripts/demo-dbs/sqs/seed.sh` | **NEW** | queues + messages (§5) |
| `scripts/demo-dbs/seed.sh` | MOD | calls the two new seed scripts |
| `scripts/demo-dbs/README.md` | MOD | documents all six engines |
| `tests/db/support/postgres.ts`, `mariadb.ts`, `redis.ts` | MOD | testcontainers presets (§7) |
| `package.json`, `bun.lock` | MOD | three new `@testcontainers/*` deps (§7) |
| `tests/ui/preconnect.spec.ts` + ~16 other `tests/ui/*.spec.ts` | MOD | `preconnectSidecar` field on every `ConnectionInput` literal (§2) |
| `docs/SPEC.md` | MOD | status line + phasing table row (this document) |
| `docs/plans/P16-misc-fixes.md` | **NEW** | this document |

**Not touched:** anything under `docs/design/` — another agent's in-progress work in that directory
(tracked and untracked) is explicitly out of scope for every change in this phase.

---

## 10. Verification

- `bun run typecheck` (all three sub-checks: `typecheck:node`, `typecheck:web`, `typecheck:db`)
  passes clean.
- Kafka/SQS demo seeding verified live against Colima: `kira-kafka`/`kira-sqs` containers healthy;
  `orders` (6 msgs across 2 partitions), `empty-topic` (0), `large-topic` (20,000 msgs, confirmed
  via `GetOffsetShell` across all 4 partitions) all present; `kira-demo-group` registered;
  `orders-queue` (5), `drain-queue` (7), `empty-queue` (0) confirmed via `awslocal sqs
  get-queue-attributes`.
- Not re-run in this session: `bun run test:ui` / `test:db` (no code path here changes adapter
  behavior beyond what §2's spec-file mechanical edits already cover under typecheck).

## 11. Non-goals

- No change to `preconnect.ts`'s settle-window race itself — only to whether the caller acts on
  `arm()` (§2).
- No brand/vendor logo assets added for the kind picker (§3, D2) — codicons only.
- `OperationsPanel.vue`'s error display and `.status-dot`'s tooltip are not routed through
  `ErrorPopover.vue` (§4) — left as documented follow-ups, not done here.
- MongoDB's testcontainers harness is not swapped to a preset package (§7, D3).
- Nothing under `docs/design/`.

---

## 12. Acceptance checklist

- [x] `preconnectSidecar` plumbed end-to-end (schema → migration → repo → main → renderer draft →
      dialog checkbox) and `bun run typecheck` passes.
- [x] `preconnect.spec.ts`'s two connect-flow scenarios set the field explicitly and match their
      exercised behavior (sidecar `true`, one-shot `false`); every other spec file's literal set
      to `false`.
- [x] Kind picker replaces the `<select>`, keeps the `connection-kind` testid, adds
      `connection-kind-${kind}` per button, disabled kinds still show "not yet supported".
- [x] `ErrorPopover.vue` used by `TreeRow.vue`; opens on click, closes on outside click/Escape,
      Copy button works.
- [x] `scripts/demo-dbs/` covers Postgres, MariaDB, MongoDB, Redis, Kafka, SQS; every service has a
      credentials comment; Kafka has `large-topic` (20k) alongside `orders`/`empty-topic`; verified
      live.
- [x] Both font-family bugs fixed.
- [x] Postgres/MariaDB/Redis testcontainers harnesses use preset packages; Mongo intentionally not
      touched.
- [x] `docs/SPEC.md` status line and phasing table updated.
- [ ] Committed on `feature/kickoff` with `docs/design/` left untouched.
