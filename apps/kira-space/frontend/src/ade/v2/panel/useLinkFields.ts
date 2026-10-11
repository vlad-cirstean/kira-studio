import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import { parseGithub } from '../board/panelFacts';
import { parseJira } from '../jira';
import type { Jira } from '../wire';

export interface LinkPatch {
  jira?: Jira;
  clearJira?: boolean;
  githubUrl?: string;
}

/** Validation and write wiring of the Jira and GitHub fields, shared by the task panel and the
 *  backlog panel. `write` resolves with an error message, or `null` on success. */
export function useLinkFields(
  githubUrl: () => string,
  write: (patch: LinkPatch) => Promise<string | null>,
) {
  const jiraError = ref('');
  const githubError = ref('');
  const github = computed(() => parseGithub(githubUrl()));

  async function saveJira(raw: string): Promise<void> {
    const j = parseJira(raw);
    jiraError.value = j.key ? '' : t('space.ade.link.notJira.error');
    if (j.key) jiraError.value = (await write({ jira: j })) ?? '';
  }

  async function saveGithub(raw: string): Promise<void> {
    githubError.value = parseGithub(raw) ? '' : t('space.ade.link.notGithub.error');
    if (!githubError.value) githubError.value = (await write({ githubUrl: raw })) ?? '';
  }

  return {
    jiraError,
    githubError,
    github,
    saveJira,
    saveGithub,
    clearJira: () => write({ clearJira: true }),
    clearGithub: () => write({ githubUrl: '' }),
  };
}
