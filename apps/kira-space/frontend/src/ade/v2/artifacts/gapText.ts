import { type MessageKey, t } from '@theme/i18n';
import type { ArtifactGap } from '../wire';

const TRACKER_LABEL: Record<string, MessageKey> = { jira: 'common.product.jira.label' };

const REASON_KEY: Record<string, MessageKey> = {
  unavailable: 'space.ade.artifacts.gap.unavailable.body',
  unauthenticated: 'space.ade.artifacts.gap.unauthenticated.body',
  notFound: 'space.ade.artifacts.gap.notFound.body',
  otherSite: 'space.ade.artifacts.gap.otherSite.body',
  timeout: 'space.ade.artifacts.gap.timeout.body',
  changeRequestsMissing: 'space.ade.artifacts.gap.changeRequestsMissing.body',
  changeRequestsUnauthenticated: 'space.ade.artifacts.gap.changeRequestsUnauthenticated.body',
  changeRequestsUnavailable: 'space.ade.artifacts.gap.changeRequestsUnavailable.body',
};

/** A tracker's display name; an unknown provider shows its id. */
function trackerName(id: string): string {
  const key = TRACKER_LABEL[id];
  return key ? t(key) : id;
}

/** Why a source is partial. Any other tracker failure reads as a plain read failure. */
export function gapText(g: ArtifactGap): string {
  const source = trackerName(g.source);
  const reason = g.reason ?? '';
  if (reason.startsWith('changeRequests') && reason !== 'changeRequestsMissing') {
    const key = REASON_KEY[reason] ?? 'space.ade.artifacts.gap.changeRequestsFailed.body';
    return t(key, { source });
  }
  const key = REASON_KEY[reason];
  if (key) return t(key, { source, count: g.count ?? 0 });
  return g.repo
    ? t('space.ade.artifacts.gap.body', { source, repo: g.repo })
    : t('space.ade.artifacts.gapNoRepo.body', { source });
}
