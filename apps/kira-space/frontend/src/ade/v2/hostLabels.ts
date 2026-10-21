import { type HostWordsSource, hostWords, t } from '@theme/i18n';
import { computed } from 'vue';
import { useGitHostProviders } from './readQueries';
import type { HostInfo, HostLink } from './wire';

/** Wording from the registered code host providers; several join with " or " in registration order. */
export function useHostLabels() {
  const providers = useGitHostProviders();
  const list = computed<readonly HostInfo[]>(() => providers.data.value?.providers ?? []);
  const joined = (pick: (p: HostWordsSource) => string): string =>
    list.value.length > 0 ? list.value.map(pick).join(' or ') : pick(hostWords(null));
  const infoOf = (provider: string): HostInfo | null =>
    list.value.find((p) => p.id === provider) ?? null;

  /** "GitHub": the link field label. */
  const labels = computed(() => joined((p) => p.label));
  /** "PR": the change request short names. */
  const shorts = computed(() => joined((p) => p.changeRequestShort));
  /** The change request short name of the provider that owns `link`. */
  const shortOf = (link: HostLink): string => hostWords(infoOf(link.provider)).changeRequestShort;
  /** "PR 12" or "Issue 12", for a link row's quiet fact. */
  const factOf = (link: HostLink): string =>
    link.kind === 'changeRequest'
      ? `${shortOf(link)} ${link.ref}`
      : t('space.common.issue.label', { ref: link.ref });
  /** The chip beside a link field. */
  const chipOf = (link: HostLink | null): string =>
    link === null
      ? ''
      : link.kind === 'changeRequest'
        ? shortOf(link)
        : t('space.ade.taskTab.issue.label');

  return { labels, shorts, infoOf, shortOf, factOf, chipOf };
}
