// P100 Part 2: split out of Kira Studio's own state/coderepos.ts (moving to kira-space's own
// frontend in this phase) — a pure, generic path normalizer with no store/state dependency, used
// by both apps' own terminal-session bookkeeping (Kira Studio's standalone Terminal module,
// state/terminals.ts + state/terminalTabs.ts; Kira Space's repo-worktree terminal, its own
// state/terminals.ts + state/coderepos.ts). One definition in packages/shared, not two duplicated
// copies — unlike the Monaco bootstrap or the PTY engine (this phase's own documented "duplicate,
// don't hoist" calls), this function has zero per-app divergence risk: it is one line of pure
// string normalization, so there is nothing for the two apps to diverge on and no reason to pay
// the duplication cost.
export function canonicalPath(p: string): string {
  const normalized = p.normalize('NFC');
  const stripped = normalized.replace(/[/\\]+$/, '');
  // F13: the filesystem root ('/', or a run of slashes that normalizes to it) has no non-separator
  // suffix to strip down to -- stripping it to '' produces a relative-looking empty string Go's
  // own terminal.ValidateOpen then rejects as not absolute. Keep one separator instead of none.
  if (stripped === '' && /^[/\\]/.test(normalized)) return normalized[0];
  return stripped;
}
