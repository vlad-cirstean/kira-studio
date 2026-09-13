// P28 D12: "is this pasted text a curl command?" — the guard in front of parseCurl on the request
// bar's own paste path.
//
// It gets its own module, and its own test, for a reason the parser's existing coverage does not
// give it: this predicate sits on a *destructive* path. A false positive replaces the user's whole
// request — method, URL, headers, body — with whatever parseCurl makes of a string that was never a
// curl command, when all they wanted was to paste a URL. A false negative merely pastes text, which
// is what used to happen anyway. So the rules below are deliberately strict, and asymmetric on
// purpose.

/** Shells and docs routinely prefix a copied command with a prompt. Recognised and skipped, so
 *  pasting straight out of a terminal transcript or a README works. */
const PROMPT_PREFIXES = ['$ ', '# ', '> ', '❯ ', '% '];

/** A `\`-continued command arrives as several lines; the *first* non-empty one is what decides. */
function firstMeaningfulLine(text: string): string {
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (line === '') continue;
    for (const prefix of PROMPT_PREFIXES) {
      if (line.startsWith(prefix)) {
        line = line.slice(prefix.length).trimStart();
        break;
      }
    }
    return line;
  }
  return '';
}

/**
 * True when `text` is a curl command this app should parse rather than paste literally.
 *
 * The rules, and why each is here:
 * - the first meaningful line's first token must be exactly `curl` (or a path ending in `/curl`,
 *   which is how a copied command from a script can arrive) — never merely *start* with it, so
 *   `curlOptions`, `curl-config` and a URL like `https://x.dev/curl` are all left alone;
 * - the token must be followed by whitespace and something else, so the bare word `curl` typed or
 *   pasted on its own is not treated as a request to blank the current one;
 * - `.exe` is accepted alongside the bare name for a command copied from a Windows shell.
 */
export function looksLikeCurlCommand(text: string): boolean {
  const line = firstMeaningfulLine(text);
  const match = /^(?:"([^"]*)"|'([^']*)'|(\S+))(\s[\s\S]*)?$/.exec(line);
  if (!match) return false;
  const command = match[1] ?? match[2] ?? match[3] ?? '';
  const rest = match[4] ?? '';
  if (rest.trim() === '') return false;

  const base = (command.split(/[/\\]/).pop() ?? '').toLowerCase();
  return base === 'curl' || base === 'curl.exe';
}
