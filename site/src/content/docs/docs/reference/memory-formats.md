---
title: Memory formats
description: The two plain-text formats for memory facts in code comments and doc files.
sources:
  - internal/memory/memfmt/memfmt.go
  - internal/memory/memfmt/parse.go
  - internal/memory/memfmt/format.go
  - internal/memory/memfmt/markers.go
  - internal/memory/importer/writedoc.go
  - docs/v2.5/plans/P273-memory-text-formats.md
sidebar:
  order: 4
---

Both formats are grep-first. Every line starts with the fact id and holds one field.

## Ids

A fact id is `km_` plus 12 lowercase Crockford base32 characters, such as `km_7h3kq9x2mfa4`. A group id uses `kg_`. Write a full id every time. A malformed `km_` or `kg_` token is a problem.

## Text rules

- One line per fact and per reason.
- No inline Markdown: no bold, emphasis, backticks, links or tags.
- No leading or trailing space.
- Cite another memory by its id only.

## Code comments

A block starts with a header line, then fact and reason pairs. The header names the origin, an optional source and the scope.

```go
// kira-memory origin=user scope=project
// km_7h3kq9x2mfa4 fact: Billing amounts are stored in cents.
// km_7h3kq9x2mfa4 reason: The ledger rejects fractional values.
```

- Origin: `user`, `agent` or `external`.
- An external origin needs `source=<tag>`: 1 to 32 characters from a-z, 0-9 and `-`. Other origins forbid it.
- Scope: `company`, `project` or `personal`.
- A comment has no project, session or keywords.

The comment marker depends on the file extension:

- `//`: go, ts, js, java, kt, swift, rs, c, cpp, cs, php, proto.
- `#`: py, sh, rb, yaml, toml, tf.
- `--`: sql, lua, hs.
- `;`: clj, el, lisp, ini.
- `%`: erl, tex.
- `<!-- -->`: html, xml, svg.
- `/* */`: css.

An extension outside the list is unsupported. The Vue and Svelte extensions take `//` or `<!-- -->`. The full list lives in `markers.go`.

Only comment lines that start with `kira-memory ` or a fact id are in scope. Other comments are never flagged.

## Doc files

A `.md` or `.txt` file is a doc when line 1 is `---` and line 2 is `kira-memory: 1`.

The front matter keys, in order:

- `group`: a `kg_` id.
- `title`.
- `origin`.
- `source`: only for origin external.
- `scope`.
- `project`: required for scope project, forbidden otherwise.
- `session`: optional, not for external.
- `keywords`: optional, comma separated.
- `updated`: optional, `YYYY-MM-DD`.

The body holds only headings and fact blocks. A fact block has `fact`, `reason` and an optional `keywords` line.

```md
---
kira-memory: 1
group: kg_4m2x8q1b7c3d
title: Billing notes
origin: external
source: confluence
scope: project
project: github.com/acme/billing
keywords: billing, ledger
updated: 2026-10-01
---

## Amounts

km_7h3kq9x2mfa4 fact: Billing amounts are stored in cents.
km_7h3kq9x2mfa4 reason: The ledger rejects fractional values.
km_7h3kq9x2mfa4 keywords: cents, amount
```

One doc has one provenance. Importing a doc needs no Claude call: the parser reads it directly. The header wins over the job's origin and scope. An agent's import waits for your confirmation when a header claims a higher origin, or another scope or project, than the job.

An import job can write each source's stored facts to `<name>.memory.md` beside it. Doc sources are skipped. An existing target is overwritten only when it is a valid doc with the same group. Facts with another provenance than the job are left out.
