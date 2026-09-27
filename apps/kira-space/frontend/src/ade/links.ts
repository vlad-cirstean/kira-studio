import type { AdePr } from './wire';

// P129 Part 6 §0.8/§0.11: pure link helpers for the panel's Branch/PR rows — no Vue import, no
// clock read, same style as `jira.ts`'s own `parseJira`.

const PR_PATH_RE = /\/pull\/(\d+)/;

/** `bridge/ade.go`'s own `validateAdePrURL`: an http(s) URL containing `/pull/<number>`. `null` for
 *  anything else (empty, garbage, a non-PR URL) — the caller shows an inline error and sends
 *  nothing. */
export function parsePr(input: string): { url: string; number: number } | null {
  const trimmed = input.trim();
  const m = trimmed.match(PR_PATH_RE);
  if (!m) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url: trimmed, number: Number(m[1]) };
}

/** Mockup `prTone` (line 1404), keyed on `ghclient.PR.State`'s own raw lowercase values (`pr.go`
 *  17: "open" | "draft" | "merged" | "closed") — no `Approved`/`Changes requested` rung (§0 standing
 *  decision: those are review states this app never shows). */
const PR_TONE: Record<string, 'grey' | 'green' | 'purple'> = {
  draft: 'grey',
  open: 'green',
  merged: 'purple',
  closed: 'grey',
};

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface PrRowView {
  /** `''` when neither a pasted nor a resolved PR exists. */
  url: string;
  /** `null` when neither source names a PR number. */
  number: number | null;
  /** Set only when a resolved PR exists and either nothing was pasted or the pasted PR is the same
   *  one (§0.11) — a pasted PR that names a different number shows as a bare `#N` link instead. */
  chip: { label: string; tone: 'grey' | 'green' | 'purple' } | null;
  title: string;
}

/** §0.11: `resolved` is `prs.branches[branch]` (`ResolveBranchPr`'s own raw state), `pasted` is the
 *  branch's own stored `prUrl` override. */
export function prRow(resolved: AdePr | undefined, pasted: string): PrRowView {
  const pastedPr = pasted ? parsePr(pasted) : null;
  const matches = !pasted || (resolved !== undefined && pastedPr?.number === resolved.number);
  const showResolved = resolved !== undefined && matches;
  return {
    url: pasted || resolved?.url || '',
    number: pastedPr?.number ?? resolved?.number ?? null,
    chip: showResolved
      ? { label: capitalize(resolved.state), tone: PR_TONE[resolved.state] ?? 'grey' }
      : null,
    title: showResolved && resolved.title ? resolved.title : '',
  };
}

/** §0.8: the Branch ref's own `href` — `webUrl` is `''` when there's no GitHub remote (renders the
 *  ref unlinked, mirroring `PrBrowserURL`'s own "disabled collapses to nothing" posture). */
export function branchWebUrl(webUrl: string, branch: string): string | null {
  if (!webUrl || !branch) return null;
  const encoded = branch
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${webUrl}/tree/${encoded}`;
}
