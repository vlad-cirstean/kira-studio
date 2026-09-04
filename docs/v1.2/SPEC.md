# Kira Studio — v1.2

v1.1 shipped: the SlickGrid grid-engine migration, the connection auth/test-matrix hardening work,
and a full post-migration code review, closed out through P29 (`docs/v1.1/SPEC.md`). This chapter's
headline is a new, user-directed feature area: an **HTTP client** — request/response tooling for
HTTP and gRPC, living alongside the existing database client inside the same app.

## What this chapter is about

The app gains a second top-level mode, **Http** (renamed to **Api** in P12 — see the module-boundary
section below; every other reference in this document still says "Http", the name in the code as of
this writing), sitting beside the existing **Studio** mode (the database client this app has always
been) behind a **custom title bar** (matching the app's own background color, not the OS chrome)
carrying the two mode tabs. Http mode is a full request client:

- **Protocols**: HTTP and gRPC only (no other protocol families in scope for this chapter —
  WebSocket was considered and explicitly dropped from scope for now).
- **Collections**, organized in a left-hand panel the same way Studio's connection tree occupies
  that position today, stored on disk in **Postman Collection format** — with **import and export**
  of that format, so a user's existing Postman collections are portable in and out of this app.
- **curl**: parse a pasted curl command into a request, and generate a curl command from the current
  request.
- **Response history** — past responses are kept and browsable, not just the latest one.
- **Raw inspection and a raw request editor** — the exact bytes sent and received are inspectable,
  and a request can be authored/edited at that raw level, not only through the structured
  method/headers/body form.
- **Status-code hints** — a short explanation of what a response's HTTP status code means, shown
  alongside it.
- **JSON handling** — syntax highlighting and a beautify (pretty-print) action for JSON bodies, both
  in requests and responses.
- **A full set of request body formats** (P3) — raw plain text, a syntax-highlighted/beautifiable
  Code mode (JavaScript, JSON, HTML, XML), form-data with real file fields, x-www-form-urlencoded,
  and binary (one local file as the whole body). Started as a Postman-parity set including GraphQL;
  GraphQL was later removed and raw's language sub-selector split into its own Code mode, so the
  mode vocabulary is this app's own rather than Postman's `body.mode` verbatim — P4's collection
  import/export is where that boundary gets a real translation.
- **Collection variables and environments** — `{{name}}` values resolved wherever a request
  references one, with a **history of prior values** for both, a **secret** checkbox per entry
  (masked inline, revealed only after a system authentication prompt — the same fingerprint/Touch ID
  confirmation this app already built for saved connection credentials), and **reordering**.
- **Faker-backed dynamic values** — a Postman/Bruno-style `{{$...}}` dynamic-variable form that
  resolves to a freshly generated value (a random name, email, UUID, timestamp, and so on) from
  `@faker-js/faker` each time a request is sent, rather than a stored value.
- **A request timeline** — a step-by-step breakdown of what happened while a request ran (DNS,
  connect, TLS handshake, wait/TTFB, content download, and so on), the way Postman's own timing tab
  works, not just a single elapsed-time number.

**The load-bearing constraint, stated up front because it decides the whole chapter's opening
phase**: most of the chrome Http mode needs already exists in Studio mode, just wired to Studio's
own data — a left-hand tree panel, a bottom/tabbed content area for open items, and the title bar
itself. None of that is written twice. **P1 modularizes those shared surfaces first** — the left
panel, the tab strip/content area, and the title bar itself — into components parameterized by mode,
so Studio keeps working unchanged on top of the same modularized panels Http is then built on,
rather than Http growing a second, parallel copy of chrome Studio already has. Every phase after P1
builds Http's own functionality on top of that shared shell.

## Studio/Http module boundary

A cross-cutting constraint for every phase in this chapter, not just its own row below: Http mode's
code should stay as separable from Studio's as practical, organized so that if this app were ever
split into two separate apps, pulling Http out would be a mechanical move rather than an untangling.
Concretely — Http-specific frontend code lives under its own directories (`frontend/src/http/`,
`frontend/src/views/httprequest/`, and so on) rather than interleaved file-by-file with Studio's own;
Http-specific Go code stays in its own packages (`internal/httpclient`, `internal/postman`, and so
on) rather than folded into Studio's; and **test suites for the two modules are kept in separate
directories/files even though the existing `test:ui`/`test:unit` commands keep running both
together** — a single test command covering both is fine, a single test *file* covering both is not.
No phase should merge Http and Studio code into one shared file where a per-module file or directory
would do instead. P12 below is the phase that goes back over the whole chapter and audits/tightens
this boundary end to end, but every phase from here on should default to the separated shape as it's
written rather than accumulate coupling for P12 to undo later.

**The target is a genuine workspace package, not just a tidy directory.** v1.3 (the Git module,
`docs/v1.3/SPEC.md`) sets the precedent this chapter's P12 now matches: real Bun workspace packages
with their own `package.json` (root `workspaces` gains a `packages/*` entry — today's `packages/`
directory, e.g. `packages/shared`, is source-only, reached via a `@shared/*` path alias with no
independent `package.json`, build, or test; that's the weaker shape this phase upgrades past, not
the one to copy), so the Api-facing frontend code is independently buildable and testable apart from
`apps/kira-studio`'s one frontend project — the same "point a new host at this package" property
that makes the split-into-a-separate-app goal real rather than aspirational. A directory move alone
does not satisfy this boundary; P12's plan is where the package split (`packages/api-core`,
`packages/api-ui`, or whatever naming its own plan settles on) is designed in full.

**The module is also renamed Http → Api in P12** — visually (the mode tab's own label, and any other
user-facing "Http" text naming the mode itself) and in code wherever an identifier, file, or
directory names *the module*, not the protocol: `frontend/src/http/` → `frontend/src/api/`,
`views/httprequest/` → `views/apirequest/` (exact naming left to P12's own plan), the mode-tab
string, and so on. This does **not** touch places where "Http" correctly names the HTTP *protocol*
rather than the module — `internal/httpclient` (the HTTP transport), `HttpBodyWire`/`httpMethodClass`
and similar protocol-shaped identifiers, and any doc prose describing HTTP the protocol all keep
saying "Http"/"HTTP", since the module also hosts gRPC (P11) and "Api" is the name for that whole
mode, not a synonym for "Http". P12's own plan is where the exact line between the two gets drawn
file by file — this paragraph states the intent, not the full list.

**Separation does not mean reimplementing shared infrastructure per module.** v1.3's own P1
(`docs/v1.3/SPEC.md`) had to build a real correlated-RPC-with-credits protocol in Go for the Git
stream, because nothing already existed there to reuse — that was genuine new capability, not
duplication. The corrected principle, now stated there and repeated here so P12 doesn't rediscover
it: once a piece of infrastructure is generic rather than module-specific (a transport protocol, a
reveal-gate flow, and so on), it belongs in its own shared package/module the first time a second
consumer is foreseeable, not duplicated per module and not deferred until that second consumer
already exists. P5's own OQ-2 (the secret-reveal flow `internal/localauth` gates, needed by both a
connection reveal in `project/` and a variable reveal in `http/`, with no shared home either can
import without recreating the coupling this boundary exists to avoid) is exactly this situation —
P12 is where that gets a real shared home rather than staying two copies with a comment each.

## Phasing

This is a starting decomposition, not a fixed contract — `P1`'s own modularization work is expected
to reveal exactly which pieces of the existing panel/tab machinery generalize cleanly and which
don't, and later rows here may be re-scoped by their own plan docs once that's known. Each row still
gets its own Opus-authored plan under `plans/` before implementation starts, per `AGENTS.md`.

| Phase | Deliverable | Why here |
|---|---|---|
| **P1 Shared UI shell: title bar, left panel, and tab/content area, modularized** | A custom title bar (app background color, not OS chrome) hosting the two top-level mode tabs (Studio / Http). Generalize the existing left-hand tree panel and the bottom tabbed content area into components parameterized by what they're showing, so a *different* left panel (a collections tree) and a *different* tab/content kind (HTTP request/response tabs) can be hosted through the same underlying panel and tab-strip machinery Studio already uses — without Studio's own behavior changing. No new user-facing HTTP functionality yet; this is purely the structural work every later phase depends on | Explicitly called out as the necessary first step: most of Http mode's chrome is chrome Studio already has, and building it twice would mean two panel implementations to maintain and two places for the same bug to exist. Doing this before any HTTP-specific feature work means every phase after it builds on the real shared shell instead of a placeholder |
| **P2 HTTP request/response core** | The minimum viable Http tab: a request builder (method, URL, query params, headers, body) sending real HTTP requests, a response viewer (status, headers, body) with JSON syntax highlighting and a beautify action, and status-code hint text shown alongside the response status | The smallest end-to-end slice of the feature — request in, response out, readable — everything after this phase adds capability on top of a working core rather than building toward one |
| **P3 Request body payload formats** | Extend the request body editor from P2 to five modes: **raw** (plain text only), **code** (JavaScript/JSON/HTML/XML, syntax-highlighted, JSON/XML also beautifiable), **x-www-form-urlencoded**, **form-data** (including real file fields), and **binary** (one local file as the whole body). Shipped at Postman parity plus GraphQL initially; GraphQL was later removed outright (not deprecated) and raw's five-language sub-selector was split into plain-text `raw` and a new top-level `code` mode, so the mode vocabulary no longer maps 1:1 onto Postman's own `body.mode` — a real translation is now P4's to build at the collection import/export boundary, not a given | Sequenced right after the core rather than folded into P2 because collections (P4) and curl generation (P5) both need to serialize/parse the *full* payload-format model — getting this right before those phases avoids revisiting their serialization once the format set changes |
| **P4 Collections: SQLite storage, real Postman-format import/export, left-panel tree** | **Storage lives in this app's existing SQLite database** (the same `kira.sqlite` connections/tabs/settings already live in), in whatever internally efficient representation the phase's own plan decides — a normalized folder/request schema, a serialized JSON column, or a mix — **not loose Postman-format files on disk**. There is no git-based, edit-the-file-directly workflow in this phase (no filesystem watching, no external-edit detection); that is explicitly deferred, not assumed away. What must be genuine, not approximate, is the **exchange format**: import reads a real Postman Collection v2.1 JSON file and reproduces its structure faithfully in SQLite, and export writes a real Postman Collection v2.1 JSON file back out from what's stored — so a collection round-trips through this app and remains a valid, faithful Postman collection on either side, even though the live, in-app representation is SQLite rather than the file itself. Surface collections in the left panel (built on P1's modularized panel) as a folder/request tree | The organizing structure the rest of the feature hangs off — history, curl, and the timeline all operate on a saved request, and a request needs somewhere to live first. SQLite keeps collections storage consistent with how every other piece of app state already persists (no new storage paradigm, no filesystem-sync problem to solve prematurely); the Postman-format fidelity is what import/export needs to actually be interoperable, and is a property of the conversion at the boundary rather than of the storage engine |
| **P5 Collection variables and environments** | Variables scoped to a collection, and separate named environments (a switchable set of variables layered on top of collection variables) — both resolved via `{{name}}` substitution wherever a request references one (URL, headers, body). Each variable/environment entry can be marked a **secret** with a checkbox; a secret's value is masked inline in the list and only shown after a system authentication prompt (reusing v1.1 P14's existing fingerprint/Touch ID reveal mechanism, not rebuilding it). Both variables and environments keep a **history of prior values**, not just the current one, and both support **reordering** | Sequenced right after collections (P4) since collection variables are scoped to a collection and need one to exist; sequenced before curl generation (now P7) because a generated curl command must substitute real values for any `{{variable}}` reference to be runnable, and before response history/raw inspector/timeline since none of those are meaningful until requests can actually use variables |
| **P6 Faker-backed dynamic values** | Postman/Bruno-style dynamic value generation inside a request — a `{{$...}}` variable form (random name, email, UUID, timestamp, and so on) resolved via `@faker-js/faker` (already a dependency, adopted in v1.1's P15 fake-data-generator phase) fresh on every send, rather than a stored value | Sequenced right after P5 because it extends the same `{{...}}` substitution engine P5 builds — a generator function resolved in place of a stored variable — rather than needing a second substitution mechanism |
| **P7 curl parse and generate** | Paste a curl command and have it populate a request (method, URL, headers, body, auth); generate an equivalent curl command from the current request's state, with any `{{variable}}`/`{{$dynamic}}` reference resolved to its real value in the generated command, since curl itself has no notion of either | Depends on P3's full payload-format model (a curl command's `-d`/`--data`/`-F` flags map onto exactly those body modes) and on P5/P6's substitution engine existing so a generated command is actually runnable as-is; benefits from P4 existing (a parsed curl command is naturally saved into a collection) |
| **P8 Response history** | Persist past responses per request (not just the most recent), browsable and comparable against each other | A response history entry is a saved snapshot of exactly what P2's response viewer already renders; sequenced after the core response viewer and after collections exist, since history is naturally scoped per saved request |
| **P9 Raw request/response inspector and raw request editor** | View the exact bytes sent and received for a request (not the structured/parsed model P2's builder presents), and author/edit a request at that raw level directly | Advanced-debugging capability that sits on top of the structured request/response model P2-P3 establish; needs a real request/response cycle to inspect, so it follows rather than precedes the core |
| **P10 Request timeline** | The full chronological sequence of what actually happened while a request ran — every step, not only the final response's own timing. Where the request involved one or more redirects, each hop is its own step with its own detail (method, URL, status, response headers), not folded away into a single number; within each hop, the phase breakdown (DNS resolution, connection, TLS handshake, wait/TTFB, content download) shown rather than one elapsed-time figure, with a reused connection shown as reused (no DNS/connect/TLS phases to report) rather than as an instant/zero one | `net/http/httptrace.ClientTrace` is the standard, low-risk mechanism for the phase data — hook callbacks on the request's context, not a parser or protocol implementation of our own — and since Go's built-in redirect-following client reuses the original request's context across every hop, one trace installed up front fires once per hop already; `internal/httpclient/client.go`'s existing `checkRedirect`/`[]RedirectHop` context-threading (added for P2/P3's own redirect-count/final-URL reporting) is the same bucketing technique this phase extends with per-hop timing, at the boundary each `checkRedirect` call marks. Needs real instrumentation of the HTTP client's own request lifecycle, which only exists once P2's core request path is built; sequenced after the raw inspector since both surface detail about the same underlying request execution |
| **P11 gRPC support** | Browse services/methods (via reflection or a supplied `.proto`) and issue unary and streaming gRPC calls, hosted through the same shell | The one non-HTTP protocol in scope for this chapter (WebSocket was dropped — see the chapter intro), schema-driven and streaming-capable, sequenced last among the feature phases so it lands on a shell and request/response/variables/history/timeline model already proven out by every phase before it |
| **P12 Studio/Http(→Api) modularization & separability audit** | Go back over every phase's output (P1-P11) and tighten the Studio/Http boundary described above: extract the Api-facing frontend code into its own genuine Bun workspace package(s) (`packages/api-core`, `packages/api-ui`, or similar — exact naming and split left to this phase's own plan; root `workspaces` gains `packages/*`) rather than just a tidier directory inside `apps/kira-studio`, matching the precedent v1.3's Git module sets; split any test file that grew to cover both modules' cases into one file per module (folder-separated, even where the runner command still runs both suites together); and audit `internal/bridge` and the remaining Go side for coupling that would block splitting Http into a standalone app later. **Also renames the module Http → Api**, visually (the mode tab and any other user-facing text naming the mode) and in code wherever an identifier/file/directory names the module rather than the HTTP protocol (`internal/httpclient` and other genuinely-protocol-shaped names are unaffected — see the module-boundary section above). Otherwise no new user-facing behavior — a structural pass, not a feature phase | Named up front as the phase every other phase should be minimizing work for, not a surprise cleanup at the end: doing this once, deliberately, after the module is feature-complete, is cheaper than either enforcing perfect separation through ten prior phases or leaving the coupling in place indefinitely. The rename belongs in the same pass since it touches the same files a separability audit is already moving, and "Api" is the honest name once gRPC (P11) makes the mode more than an HTTP client. The package split (rather than a directory-only move) matches v1.3's Git module so the two modules end up structurally consistent with each other, not just each internally tidy |
| **P13 Api module UI check and improvement** | A dedicated pass over every Api-mode surface (request builder, response viewer, collections tree, dialogs, empty/error states, and so on) checked against the rest of the app's own design system (`docs/design/kira-design-system`, `primitives.css`, the shared token scale) rather than each earlier phase's own ad hoc styling — brought consistent with Studio mode's spacing/type/color/icon conventions, tightened for practical, efficient use (dense enough for a power tool, not sparse for its own sake), and any leftover placeholder or rough-edge styling from earlier phases cleaned up. No new functionality — a visual/interaction-consistency pass, not a feature phase | Sequenced after modularization and the rename (P12) so it's polishing the module under its final name and directory shape rather than styling files P12 is about to move; sequenced before the code review (P14) so that review reads the UI in its finished, polished state rather than reviewing styling about to change again |
| **P14 Api module code review (2 rounds)** | Two rounds of dedicated code review scoped to the Api module only (renamed from Http in P12) — everything under its now-separated directories, plus its facing halves of `internal/httpclient`, `internal/postman`, and `internal/bridge` — the same discipline v1.1's P12 applied chapter-wide (`docs/v1.1/SPEC.md`), focused here on this chapter's own module | Sequenced last, after modularization, the rename, and the UI pass, so the review reads the module under its final name and in its final, separated, polished shape rather than reviewing code P12/P13 are about to move, rename, or restyle out from under it |
