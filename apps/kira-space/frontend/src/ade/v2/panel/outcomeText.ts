import { shortSha } from '@kira/git-core';
import { t } from '@theme/i18n';
import type { Run } from '../wire';

/** The plain-text report "Copy for agent" puts on the clipboard. */
export function outcomeText(run: Run, title: string, state: string): string {
  const outcome = run.outcome;
  const rebase = outcome?.rebase ?? null;
  const files = [
    ...new Set([...(rebase?.conflictedFiles ?? []), ...(outcome?.report?.conflictedFiles ?? [])]),
  ];
  const o = outcome;
  const head = { title, state };
  const lines = [
    o?.reason
      ? t('space.ade.outcome.copy.headReason.label', { ...head, reason: o.reason })
      : t('common.withDetail.label', { first: head.title, second: head.state }),
  ];
  if (o) {
    lines.push(
      t(
        o.reported ? 'space.ade.outcome.endedByReported.label' : 'space.ade.outcome.endedBy.label',
        { source: o.source },
      ),
    );
  }
  if (rebase) {
    lines.push(
      t(
        rebase.verified
          ? 'space.ade.outcome.copy.verified.label'
          : 'space.ade.outcome.copy.notVerified.label',
      ),
    );
    if (rebase.aborted) lines.push(t('space.ade.outcome.copy.aborted.body'));
    if (rebase.inProgress) lines.push(t('space.ade.outcome.copy.inProgress.body'));
  }
  if (files.length)
    lines.push(t('space.ade.outcome.copy.conflicted.label', { files: files.join(', ') }));
  if (o?.report?.lastGitError)
    lines.push(t('space.ade.outcome.copy.gitError.label', { error: o.report.lastGitError }));
  if (o?.report?.tried) lines.push(t('space.ade.outcome.tried.label', { tried: o.report.tried }));
  for (const b of rebase?.branches ?? []) {
    lines.push(
      t(
        b.onBase
          ? 'space.ade.outcome.copy.branch.label'
          : 'space.ade.outcome.copy.branchOffBase.label',
        {
          name: b.name,
          before: shortSha(b.before),
          after: shortSha(b.after),
        },
      ),
    );
  }
  return lines.join('\n');
}
