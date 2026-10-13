---
title: Contributing
description: How changes are planned, committed and documented in this repository.
sources:
  - CLAUDE.md
  - docs/HUMAN_CODE_REVIEW.md
  - site/scripts/docsRules.ts
  - docs/v2.5/plans/P284-astro-documentation.md
sidebar:
  order: 3
---

`CLAUDE.md` in the repository root is the working agreement. This page summarises the parts that matter for outside changes.

## Phases and plans

Work proceeds in phases listed in a chapter's `SPEC.md`. Each phase has a written plan under the chapter's `plans/` folder before implementation starts. One feature branch per chapter. There are no per-phase pull requests.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Mark a breaking change with `!` or a `BREAKING CHANGE:` footer.

A failing hook is fixed at its cause. `--no-verify` never means done.

## Code

- Every Vue component uses `<script setup lang="ts">`.
- A Pinia store owns one concern.
- Use an existing, well-maintained library before hand-rolling non-trivial infrastructure.
- Use only fully open-source libraries.
- Comments are short and say why, never what.
- Unit tests cover advanced logic only, such as parsers, boundary arithmetic and concurrency.

## Communication style

Every markdown doc in the repository follows one style, except the root `README.md`. That includes these docs pages.

- Write terse. Cut filler words and pleasantries.
- One idea per sentence, about 20 words, active voice, present tense.
- Use the imperative for instructions.
- One term per concept.
- Never touch negations, numbers, units, code, error strings or API names.
- Use normal prose for security warnings, irreversible actions and places where terse text would be ambiguous.
- If the terse phrasing is not shorter, use the plain phrasing.

## Docs rules

`bun run lint` runs `site/scripts/check-docs.ts` over every page. The rules live in `site/scripts/docsRules.ts`:

- D1: a sentence has at most 25 words.
- D2: no filler words.
- D3: no invented abbreviations.
- D4: no arrows in prose.
- D5: no emoji.
- D6: a table has at least 3 columns and 3 body rows. Otherwise use a list.
- D7: UI terms. Write repository, folder, Settings, colour, cancelled and GitHub.
- D8: no `TODO`, `TBD`, `FIXME` or `XXX`.
- D9: frontmatter has `title`, a one-sentence `description` and `sources`.

A caution or danger aside allows long sentences and filler, because it holds normal prose. Every other rule still applies. There is no per-line exemption: rewrite the sentence.

## Manual review checklist

The check cannot judge style. Read each changed page once against this list:

1. One idea per sentence. Active voice. Present tense where true.
2. Instructions use the imperative.
3. One term per concept across all pages, matching the UI labels.
4. A pronoun only with one possible referent.
5. Normal prose only in caution and danger asides, and only for security, irreversible actions or real ambiguity.
6. Every claim traces to a file in `sources:`.
7. If the terse phrasing is not shorter, use the plain phrasing.

## Add a docs page

1. Create a `.md` file under `site/src/content/docs/docs/<group>/`. Use `.mdx` only to show a screenshot.
2. Add frontmatter: `title`, `description`, `sources` and `sidebar.order`.
3. List in `sources:` every repository path the claims come from. The check fails on a path that does not exist.
4. Quote UI labels from `packages/theme/src/i18n/en.json`.
5. Link other pages with a relative path and a trailing slash.
6. Run `bun run lint` and `bun run site:check`.

When code changes, search for `sources:` entries that name the changed path and update those pages.
