---
title: Memory formats
description: The two plain-text formats for memory facts in code comments and doc files.
sources:
  - internal/memory/memfmt/memfmt.go
  - internal/memory/memfmt/parse.go
  - internal/memory/memfmt/format.go
  - internal/memory/memcheck/check.go
  - internal/memory/importer/writedoc.go
  - internal/memory/memfmt/locator.go
  - docs/v2.5/plans/P273-memory-text-formats.md
  - docs/v2.5/plans/P285-part3-compact-memory-output.md
sidebar:
  order: 4
---

Both formats are grep-first. Every fact line starts with the fact id and holds the fact text. A reason is optional and sits on the next line, indented by two spaces. There are no field names and no per-fact keywords.

## Ids

A fact id is `km_` plus 12 lowercase Crockford base32 characters, such as `km_7h3kq9x2mfa4`. A group id uses `kg_`. Write a full id every time. A malformed `km_` or `kg_` token is a problem.

## Text rules

- One line per fact and per reason.
- No inline Markdown: no bold, emphasis, backticks, links or tags.
- No leading or trailing space.
- Cite another memory by its id only.

## Code comments

A block starts with a header line, then facts. The header names the origin, an optional source and the scope.

```go
// kira-memory origin=user scope=project
// km_7h3kq9x2mfa4 Billing amounts are stored in cents, because the ledger rejects fractional values.
// km_2b8c4d6f8g0h Staging deploys at 09:00 UTC.
//   Release calendar fixes it.
```

- Origin: `user`, `agent` or `external`.
- An external origin needs `source=<tag>`: 1 to 32 characters from a-z, 0-9 and `-`. Other origins forbid it.
- Scope: `company`, `project` or `personal`.
- A comment has no project, session or keywords.
- A reason is the next comment line, indented by exactly two spaces after the marker and its space.

The comment marker depends on the file extension:

- `//`: go, ts, js, java, kt, swift, rs, c, cpp, cs, php, proto.
- `#`: py, sh, rb, yaml, toml, tf.
- `--`: sql, lua, hs.
- `;`: clj, el, lisp, ini.
- `%`: erl, tex.
- `<!-- -->`: html, xml, svg.
- `/* */`: css.

An extension outside the list is unsupported. The Vue and Svelte extensions take `//` or `<!-- -->`. The full list lives in `markers.go`.

Only comment lines that start with `kira-memory ` or a fact id are in scope, plus an indented reason right after a fact. Other comments are never flagged.

## Doc files

A `.md` or `.txt` file is a doc when line 1 is `---` and line 2 is `kira-memory: 2`.

The front matter keys, in order:

- `group`: a `kg_` id.
- `title`.
- `from`: optional, the path of the source the facts were stated in, relative to the import root.
- `origin`.
- `source`: only for origin external.
- `scope`.
- `project`: required for scope project, forbidden otherwise.
- `session`: optional, not for external.
- `keywords`: optional, comma separated, for the whole doc.
- `updated`: optional, `YYYY-MM-DD`.

The body holds only `##` headings and fact items: `- <id> <fact>`, then an optional indented reason line.

```md
---
kira-memory: 2
group: kg_4m2x8q1b7c3d
title: Billing runbook
from: docs/billing-runbook.md
origin: agent
scope: project
project: github.com/acme/billing
updated: 2026-10-14
---

## Amounts

- km_7h3kq9x2mfa4 Billing amounts are stored in cents, because the ledger rejects fractional values.

## Deploys

- km_9c2d4e6f8g1h Staging deploys at 09:00 UTC.
  Release calendar, confirmed by ops in March.
```

A fact without a reason line was stated in the source under its heading. Importing the doc gives it the reason `Stated in <from>, <heading>`, or `Stated in <from>` before any heading. Kira builds that text itself.

One doc has one provenance. Importing a doc needs no Claude call: the parser reads it directly. The header wins over the job's origin and scope. An agent's import waits for your confirmation when a header claims a higher origin, or another scope or project, than the job.

A `kira-memory: 1` doc, or a comment line written as `<id> fact:` or `<id> reason:`, is the retired earlier format. It is reported as one problem. Rewrite it in this format.

An import job can write each source's stored facts to `<name>.memory.md` beside it. Doc sources are skipped. An existing target is overwritten only when it is a doc with the same group. Facts with another provenance than the job are left out. A fact whose reason is only the source and its heading becomes an item under that heading with no reason line. Any other reason is written in full. The writer adjusts a title (`: ` becomes ` - `) and strips inline Markdown from facts. A fact that stays invalid is left out. Per-fact keywords are not written, so an imported doc indexes its facts with the doc keywords only.
