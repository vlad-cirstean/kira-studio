import type { TextRef } from '@kira/git-core';
import { t } from '@theme/i18n';

/** Renders a text-free `TextRef` from git-core. */
export function renderText(ref: TextRef): string {
  return t(ref.key, ref.params);
}
