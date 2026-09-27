// P129 Part 5 §0.19: the Add popover's own Jira field takes either a bare key or a pasted link
// (mockup line 793's own `parseJira`) — one input, split into the two wire fields `AddNewWork`
// wants. The key pattern mirrors `bridge/ade.go`'s own `adeJiraKeyRe` exactly, except unanchored:
// Go validates a key value in isolation, this extracts one out of arbitrary pasted text.
const JIRA_KEY_RE = /[A-Z][A-Z0-9]+-\d+/;

/** `{key: '', url: ''}` for empty/unrecognized input — `AddNewWork`'s own `Validate` already
 *  requires title or key, so this never needs to reject anything itself. */
export function parseJira(input: string): { key: string; url: string } {
  const trimmed = input.trim();
  const key = trimmed.match(JIRA_KEY_RE)?.[0] ?? '';
  let url = '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = trimmed;
  } catch {
    // Not a URL — a bare key (or garbage) leaves `url` empty.
  }
  return { key, url };
}
