import { split } from 'shlex';

// P7 D1/D3: the shell-quoting half of curl parsing is `shlex@3.0.0` (F8's measurement) — this
// module is the whole of that half. `split()` is called with no options, so ANSI-C (`$'…'`) and
// locale (`$"…"`) quoting stay on and no environment substitution ever happens (F8's contract):
// `$TOKEN` and `{{token}}` both survive a paste untouched.
//
// D4: the warning vocabulary is a closed union (mirrors internal/postman's own warning kinds,
// P4 D12) — defined here rather than in parse.ts because D18 pins tokenize.ts to "shlex only" as
// its one dependency, and this module's own TokenizeResult already needs the type. parse.ts
// re-exports it for its own public API; every other CurlWarningKind member is used only there.
export const CURL_WARNING_KINDS = [
  'shell-operator',
  'unknown-flag',
  'unsupported-flag',
  'method-coerced',
  'multiple-urls',
  'header-malformed',
  'data-file-inline',
  'form-file-content',
  'form-filename',
  'implied-content-type',
  'credential-in-command',
  'no-url',
] as const;
export type CurlWarningKind = (typeof CURL_WARNING_KINDS)[number];
export interface CurlWarning {
  kind: CurlWarningKind;
  detail: string;
}

export type TokenizeResult =
  | { ok: true; argv: string[]; warnings: CurlWarning[] }
  | { ok: false; error: string };

// F9/D3: nothing here is ever executed — this app never runs a shell — but a bare `;`, `|`, `&`,
// `&&`, `||`, `>`, `>>`, `<` or `#` is where a naive walk would start mistaking the rest of the
// line (an `rm -rf /` after a `;`) for more curl arguments. shlex has no notion of shell syntax
// above the word level (F9), so these only ever appear as their own token when they were bare in
// the source — a quoted `;` comes back as part of its own argument, never as this exact string.
const SHELL_OPERATORS = new Set(['|', '||', '&', '&&', ';', '>', '>>', '<', '#']);

/**
 * Turns pasted curl text into `argv`. D3, in full:
 *
 * 1. `shlex.split` does the real lexing (quotes, escapes, ANSI-C `$'…'`); an unterminated quote or
 *    a trailing escape throws, caught here and returned as `{ok:false, error}` — a legible parse
 *    error, never an uncaught exception.
 * 2. A leading token equal to `curl` or ending `/curl` is dropped silently — the common case of a
 *    full paste including the command name. Anything else is left exactly where it was: the flag
 *    table (parse.ts) is what decides meaning, so a fragment starting at `-X POST` parses with no
 *    special-casing, and a genuinely unexpected leading word simply becomes a non-flag argument
 *    for D5's own URL-pick / multiple-urls rule to account for — no separate warning kind exists
 *    for it (D4's union is closed).
 * 3. The walk stops at the first bare shell operator, keeping every token before it and emitting a
 *    `shell-operator` warning naming what was dropped.
 */
export function tokenize(text: string): TokenizeResult {
  let argv: string[];
  try {
    argv = split(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (argv.length > 0 && (argv[0] === 'curl' || argv[0].endsWith('/curl'))) {
    argv = argv.slice(1);
  }

  const warnings: CurlWarning[] = [];
  const stopIndex = argv.findIndex((token) => SHELL_OPERATORS.has(token));
  if (stopIndex !== -1) {
    const dropped = argv.slice(stopIndex);
    warnings.push({
      kind: 'shell-operator',
      detail: `Stopped at '${dropped[0]}' — this app never runs a shell, so nothing after it was parsed.`,
    });
    argv = argv.slice(0, stopIndex);
  }

  return { ok: true, argv, warnings };
}
