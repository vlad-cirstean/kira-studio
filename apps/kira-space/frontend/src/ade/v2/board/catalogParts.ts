import type { MessageKey } from '@theme/i18n';
import { t } from '@theme/i18n';
import type { TextPart } from '@theme/varText';

const MARK = '\u0001';

/** A catalog message as `VarText` parts: `vars` render as variables, `text` as plain words. */
export function catalogParts(
  key: MessageKey,
  vars: Record<string, string> = {},
  text: Record<string, string | number> = {},
): TextPart[] {
  const probe = Object.fromEntries(Object.keys(vars).map((n) => [n, `${MARK}${n}${MARK}`]));
  return t(key, { ...text, ...probe })
    .split(MARK)
    .flatMap((seg, i): TextPart[] => {
      if (i % 2 === 1) return [{ name: seg, value: vars[seg] }];
      return seg ? [seg] : [];
    });
}
