import { shortSha } from '@kira/git-core';
import type { ReviewComment } from '@kira/git-ipc';
import type { TextPart } from '@theme/varText';
import { catalogParts } from '../../ade/v2/board/catalogParts';

/** Display parts for a comment whose anchor moved; undefined while the anchor still holds. */
export function anchorParts(
  comment: ReviewComment | undefined,
  branch: string,
): TextPart[] | undefined {
  if (!comment) return undefined;
  const vars = { branch, sha: shortSha(comment.anchorSha) };
  switch (comment.anchor) {
    case 'removed':
      return catalogParts('space.repo.view.anchorRemoved.status', vars, {}, ['branch']);
    case 'stale':
      return catalogParts('space.repo.view.anchorStale.status', vars, {}, ['branch']);
    default:
      return undefined;
  }
}
