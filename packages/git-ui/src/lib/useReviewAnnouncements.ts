import { t } from '@theme/i18n';
import { computed, type Ref, watch } from 'vue';
import type { ReviewSessionState } from '../state/review.ts';

/**
 * Feeds the review view's polite live region: the session's per-row announcement (copy,
 * open-in-editor, go-to-file outcomes) and one announcement each time a phase is entered, so a
 * screen-reader user learns "nothing to review" rather than meeting silence.
 */
export function useReviewAnnouncements(
  review: Readonly<Ref<ReviewSessionState | undefined>>,
  announce: (text: string) => void,
): void {
  const commitCountLabel = computed(() => {
    const resolution = review.value?.resolution.value;
    if (resolution?.range.kind !== 'ready') return '';
    return t('git.review.commits.count.label', { count: resolution.range.commitCount });
  });

  watch(
    () => review.value?.announcement.value,
    (text) => {
      if (text !== undefined) announce(text);
    },
    { deep: true },
  );

  watch(
    () => review.value?.phase.value,
    (phase) => {
      const r = review.value;
      if (!r) return;
      const branch = r.branch.value ?? '';
      const base = r.resolution.value?.base ?? '';
      switch (phase) {
        case 'ask':
          announce(t('git.review.phase.ask.announce', { branch }));
          break;
        case 'unrelated':
          announce(t('git.review.phase.unrelated.announce', { branch, base }));
          break;
        case 'empty':
          announce(t('git.review.phase.empty.announce', { branch, base }));
          break;
        case 'listing':
          announce(
            t('git.review.phase.listing.announce', {
              branch,
              base,
              summary: commitCountLabel.value,
            }),
          );
          break;
        case 'error':
          announce(
            t('git.review.phase.error.error', { branch, error: r.resolveError.value ?? '' }),
          );
          break;
        default:
          break;
      }
    },
  );
}
