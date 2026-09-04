/**
 * The trailing path segment of a repo root, used as `RepoPicker.vue`'s trigger label and
 * `NoRepositoryPanel.vue`'s candidate list — pure so it can be unit-tested directly (the
 * pure/DOM-split precedent `palette.ts`/`rowSvg.ts` established in W7/W8). Handles both "/" and
 * "\\" separators since `RepoSummary.root` can come from either a POSIX or a Windows-hosted git
 * process, regardless of which platform the UI itself is currently running on.
 */
export function shortRepoLabel(root: string): string {
  const trimmed = root.replace(/[/\\]+$/, '');
  const segments = trimmed.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? (segments[segments.length - 1] as string) : root;
}
