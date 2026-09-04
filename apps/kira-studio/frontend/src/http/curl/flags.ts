// P7 D6: the flag table is data. One entry per known spelling (long and short alike); the only
// thing the argv walk needs to stay in step is `arity` — a flag whose arity we get wrong swallows
// the URL, which is F6's exact failure mode in every published parser. Two deliberately separate
// "not represented" categories (`ignored` vs `warned`) rather than one, because conflating them is
// how an importer becomes either noisy (flagging things that change nothing) or dishonest (staying
// silent about things that do) — D6's own reasoning.

export type CurlFlagArity = 0 | 1;
export type CurlFlagCategory = 'known' | 'ignored' | 'warned';

// D5/D8/D9: the semantic id a 'known' flag feeds — parse.ts switches on this rather than on the
// raw spelling, so `-H`/`--header` and `-X`/`--request` are indistinguishable once looked up.
export type CurlFlagId =
  | 'request'
  | 'head'
  | 'upload-file'
  | 'get'
  | 'url'
  // F10-F13: the four -d-family spellings differ in their @-handling and are kept as distinct ids
  // rather than one shared 'data' — 'data' is -d/--data/--data-ascii (an @file is inlined with
  // newlines stripped), 'data-raw' never gives @ special meaning, 'data-binary' inlines an @file
  // without stripping newlines, and 'data-urlencode' has its own @/=@/name@ forms (D8).
  | 'data'
  | 'data-raw'
  | 'data-binary'
  | 'data-urlencode'
  | 'form'
  | 'form-string'
  | 'header'
  | 'user-agent'
  | 'referer'
  | 'cookie'
  | 'user'
  | 'oauth2-bearer'
  | 'json';

export interface FlagSpec {
  category: CurlFlagCategory;
  arity: CurlFlagArity;
  /** Only present for `category: 'known'`. */
  id?: CurlFlagId;
}

function known(id: CurlFlagId, arity: CurlFlagArity): FlagSpec {
  return { category: 'known', arity, id };
}
function ignored(arity: CurlFlagArity): FlagSpec {
  return { category: 'ignored', arity };
}
function warned(arity: CurlFlagArity): FlagSpec {
  return { category: 'warned', arity };
}

// One record per spelling — long and short forms of the same flag are separate keys pointing at
// equal specs, not aliases resolved at lookup time, so the table stays a plain object literal.
export const FLAG_TABLE: Readonly<Record<string, FlagSpec>> = {
  // ---- D5: method, URL, headers, credential sugar ----
  '-X': known('request', 1),
  '--request': known('request', 1),
  '-I': known('head', 0),
  '--head': known('head', 0),
  '-T': known('upload-file', 1),
  '--upload-file': known('upload-file', 1),
  '-G': known('get', 0),
  '--get': known('get', 0),
  '--url': known('url', 1),
  '-H': known('header', 1),
  '--header': known('header', 1),
  '-A': known('user-agent', 1),
  '--user-agent': known('user-agent', 1),
  '-e': known('referer', 1),
  '--referer': known('referer', 1),
  '-b': known('cookie', 1),
  '--cookie': known('cookie', 1),
  '-u': known('user', 1),
  '--user': known('user', 1),
  '--oauth2-bearer': known('oauth2-bearer', 1),
  '--json': known('json', 1),

  // ---- D7/D8: the -d family and -F/--form-string (D10/F10) ----
  '-d': known('data', 1),
  '--data': known('data', 1),
  '--data-ascii': known('data', 1),
  '--data-raw': known('data-raw', 1),
  '--data-binary': known('data-binary', 1),
  '--data-urlencode': known('data-urlencode', 1),
  '-F': known('form', 1),
  '--form': known('form', 1),
  // F10: --form-string is what D15 generates for a text row, so parse.ts (D17's round trip) must
  // recognise it on the way back in too — it behaves like -F but never gives @ or < special
  // meaning (curl's own documented contract for the flag).
  '--form-string': known('form-string', 1),

  // ---- D6: ignored silently — flags that change nothing about the request as the server sees it ----
  '-s': ignored(0),
  '--silent': ignored(0),
  '-S': ignored(0),
  '--show-error': ignored(0),
  '-v': ignored(0),
  '--verbose': ignored(0),
  '-i': ignored(0),
  '--include': ignored(0),
  '-o': ignored(1),
  '--output': ignored(1),
  '-O': ignored(0),
  '--remote-name': ignored(0),
  '-w': ignored(1),
  '--write-out': ignored(1),
  '--fail': ignored(0),
  '-#': ignored(0),
  '--progress-bar': ignored(0),
  '-N': ignored(0),
  '--no-buffer': ignored(0),
  '--compressed': ignored(0),
  '-L': ignored(0),
  '--location': ignored(0),
  '--http1.0': ignored(0),
  '--http1.1': ignored(0),
  '--http2': ignored(0),
  '--http3': ignored(0),
  '--retry': ignored(1),
  '--retry-delay': ignored(1),
  '--retry-max-time': ignored(1),
  '--retry-connrefused': ignored(0),
  '--retry-all-errors': ignored(0),
  '-4': ignored(0),
  '--ipv4': ignored(0),
  '-6': ignored(0),
  '--ipv6': ignored(0),

  // ---- D6: warned (unsupported-flag) — flags that would have changed the request and cannot be
  //          represented ----
  '-k': warned(0),
  '--insecure': warned(0),
  '-x': warned(1),
  '--proxy': warned(1),
  '--cert': warned(1),
  '-E': warned(1),
  '--key': warned(1),
  '--cacert': warned(1),
  '--resolve': warned(1),
  '--interface': warned(1),
  '-c': warned(1),
  '--cookie-jar': warned(1),
  '--limit-rate': warned(1),
  '-m': warned(1),
  '--max-time': warned(1),
  '--connect-timeout': warned(1),
  '-K': warned(1),
  '--config': warned(1),
  '--proto': warned(1),
  '--proto-default': warned(1),
  '--proto-redir': warned(1),
  '--netrc': warned(0),
  '--netrc-file': warned(1),
  '--netrc-optional': warned(0),
  '--anyauth': warned(0),
  '--digest': warned(0),
  '--ntlm': warned(0),
};

/** Exact-spelling lookup only — no clustering, no `=` splitting (the argv walk does both before
 *  calling this). */
export function lookupFlag(token: string): FlagSpec | undefined {
  return FLAG_TABLE[token];
}

/**
 * D6: "short-flag clustering (`-sSL`) is expanded". Only ever expands a cluster whose every
 * character is a *known, arity-0* short flag — the same safety margin D6's "an unknown flag is
 * assumed to take no value" rule uses: a cluster that might end in a value-taking flag (getopt's
 * own `-o file` glued as `-Xo`) is deliberately left alone rather than guessed at, and falls
 * through to an ordinary (likely `unknown-flag`) lookup instead.
 */
export function expandShortCluster(token: string): string[] | null {
  if (token.length < 3 || token[0] !== '-' || token[1] === '-') return null;
  const chars = [...token.slice(1)];
  const flags = chars.map((c) => `-${c}`);
  if (!flags.every((f) => lookupFlag(f)?.arity === 0)) return null;
  return flags;
}
