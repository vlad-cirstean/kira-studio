# Kira Studio — v1.2

v1.1 shipped: the SlickGrid grid-engine migration, the connection auth/test-matrix hardening work,
and a full post-migration code review, closed out through P29 (`docs/v1.1/SPEC.md`). This chapter's
headline is a new, user-directed feature area: an **HTTP client** — request/response tooling for
HTTP and gRPC, living alongside the existing database client inside the same app.

## What this chapter is about

The app gains a second top-level mode, **Http**, sitting beside the existing **Studio** mode (the
database client this app has always been) behind a **custom title bar** (matching the app's own
background color, not the OS chrome) carrying the two mode tabs. Http mode is a full request client:

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
- **Payload format parity with Postman** — the request body editor supports the same set of input
  formats Postman does (raw text, JSON, XML, form-data with file fields, x-www-form-urlencoded,
  binary, GraphQL, and whatever else Postman's own body-mode set covers), not a reduced subset.
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

## Phasing

This is a starting decomposition, not a fixed contract — `P1`'s own modularization work is expected
to reveal exactly which pieces of the existing panel/tab machinery generalize cleanly and which
don't, and later rows here may be re-scoped by their own plan docs once that's known. Each row still
gets its own Opus-authored plan under `plans/` before implementation starts, per `AGENTS.md`.

| Phase | Deliverable | Why here |
|---|---|---|
| **P1 Shared UI shell: title bar, left panel, and tab/content area, modularized** | A custom title bar (app background color, not OS chrome) hosting the two top-level mode tabs (Studio / Http). Generalize the existing left-hand tree panel and the bottom tabbed content area into components parameterized by what they're showing, so a *different* left panel (a collections tree) and a *different* tab/content kind (HTTP request/response tabs) can be hosted through the same underlying panel and tab-strip machinery Studio already uses — without Studio's own behavior changing. No new user-facing HTTP functionality yet; this is purely the structural work every later phase depends on | Explicitly called out as the necessary first step: most of Http mode's chrome is chrome Studio already has, and building it twice would mean two panel implementations to maintain and two places for the same bug to exist. Doing this before any HTTP-specific feature work means every phase after it builds on the real shared shell instead of a placeholder |
| **P2 HTTP request/response core** | The minimum viable Http tab: a request builder (method, URL, query params, headers, body) sending real HTTP requests, a response viewer (status, headers, body) with JSON syntax highlighting and a beautify action, and status-code hint text shown alongside the response status | The smallest end-to-end slice of the feature — request in, response out, readable — everything after this phase adds capability on top of a working core rather than building toward one |
| **P3 Request body payload formats, at Postman parity** | Extend the request body editor from P2 to the full set of input modes Postman supports: raw text, JSON, XML, form-data (including file fields), x-www-form-urlencoded, binary, GraphQL, and any other body mode Postman's own format exposes | Sequenced right after the core rather than folded into P2 because collections (P4) and curl generation (P5) both need to serialize/parse the *full* payload-format model, not just JSON — getting this right before those phases avoids revisiting their serialization once the format set grows |
| **P4 Collections: SQLite storage, real Postman-format import/export, left-panel tree** | **Storage lives in this app's existing SQLite database** (the same `kira.sqlite` connections/tabs/settings already live in), in whatever internally efficient representation the phase's own plan decides — a normalized folder/request schema, a serialized JSON column, or a mix — **not loose Postman-format files on disk**. There is no git-based, edit-the-file-directly workflow in this phase (no filesystem watching, no external-edit detection); that is explicitly deferred, not assumed away. What must be genuine, not approximate, is the **exchange format**: import reads a real Postman Collection v2.1 JSON file and reproduces its structure faithfully in SQLite, and export writes a real Postman Collection v2.1 JSON file back out from what's stored — so a collection round-trips through this app and remains a valid, faithful Postman collection on either side, even though the live, in-app representation is SQLite rather than the file itself. Surface collections in the left panel (built on P1's modularized panel) as a folder/request tree | The organizing structure the rest of the feature hangs off — history, curl, and the timeline all operate on a saved request, and a request needs somewhere to live first. SQLite keeps collections storage consistent with how every other piece of app state already persists (no new storage paradigm, no filesystem-sync problem to solve prematurely); the Postman-format fidelity is what import/export needs to actually be interoperable, and is a property of the conversion at the boundary rather than of the storage engine |
| **P5 curl parse and generate** | Paste a curl command and have it populate a request (method, URL, headers, body, auth); generate an equivalent curl command from the current request's state | Depends on P3's full payload-format model (a curl command's `-d`/`--data`/`-F` flags map onto exactly those body modes) and benefits from P4 existing (a parsed curl command is naturally saved into a collection) |
| **P6 Response history** | Persist past responses per request (not just the most recent), browsable and comparable against each other | A response history entry is a saved snapshot of exactly what P2's response viewer already renders; sequenced after the core response viewer and after collections exist, since history is naturally scoped per saved request |
| **P7 Raw request/response inspector and raw request editor** | View the exact bytes sent and received for a request (not the structured/parsed model P2's builder presents), and author/edit a request at that raw level directly | Advanced-debugging capability that sits on top of the structured request/response model P2-P3 establish; needs a real request/response cycle to inspect, so it follows rather than precedes the core |
| **P8 Request timeline** | A step-by-step timing breakdown of a request's lifecycle — DNS resolution, connection, TLS handshake, wait/TTFB, content download — rather than a single elapsed-time figure | Needs real instrumentation of the HTTP client's own request lifecycle, which only exists once P2's core request path is built; sequenced after the raw inspector since both surface detail about the same underlying request execution |
| **P9 gRPC support** | Browse services/methods (via reflection or a supplied `.proto`) and issue unary and streaming gRPC calls, hosted through the same shell | The one non-HTTP protocol in scope for this chapter (WebSocket was dropped — see the chapter intro), schema-driven and streaming-capable, sequenced last so it lands on a shell and request/response/history/timeline model already proven out by every phase before it |
