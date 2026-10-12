import { shortSha } from '@kira/git-core';
import type { TextPart } from '@theme/varText';
import { catalogParts } from '../board/catalogParts';

/** "PR head X differs from local Y" with both shas as variables. */
export function headDiffersParts(headSha: string, localTip: string): TextPart[] {
  return catalogParts('space.ade.review.sync.headDiffers.label', {
    head: shortSha(headSha),
    local: shortSha(localTip),
  });
}
