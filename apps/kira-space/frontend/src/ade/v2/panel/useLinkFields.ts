import { t } from '@theme/i18n';
import { ref } from 'vue';
import { parseJira } from '../jira';
import type { HostLink, Jira } from '../wire';

export interface LinkPatch {
  jira?: Jira;
  clearJira?: boolean;
  hostUrl?: string;
}

/** Validation and write wiring of the Jira and git host link fields, shared by the task panel and the
 *  backlog panel. `write` resolves with an error message, or `null` on success. */
export function useLinkFields(
  hostLink: () => HostLink | null,
  write: (patch: LinkPatch) => Promise<string | null>,
) {
  const jiraError = ref('');
  const githubError = ref('');

  async function saveJira(raw: string): Promise<void> {
    const j = parseJira(raw);
    jiraError.value = j.key ? '' : t('space.ade.link.notJira.error');
    if (j.key) jiraError.value = (await write({ jira: j })) ?? '';
  }

  async function saveGithub(raw: string): Promise<void> {
    githubError.value = (await write({ hostUrl: raw })) ?? '';
  }

  return {
    jiraError,
    githubError,
    hostLink,
    saveJira,
    saveGithub,
    clearJira: () => write({ clearJira: true }),
    clearGithub: () => write({ hostUrl: '' }),
  };
}
