import { BUILTIN_VARS } from '@shared/domain/scripts';
import type { TextPart } from '@theme/varText';

const VAR_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** A smart script body as chips: a built-in shows its known value, else itself; a param shows its
 *  step values, else itself; any other braces stay text. */
export function smartBodyParts(
  body: string,
  params: Readonly<Record<string, readonly string[]>>,
  known: Readonly<Record<string, string>> = {},
): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1] ?? '';
    const builtin = (BUILTIN_VARS as readonly string[]).includes(name);
    if (!builtin && !(name in params)) continue;
    if (m.index > at) parts.push(body.slice(at, m.index));
    const given = builtin ? known[name] : params[name]?.join(', ');
    parts.push({ name, value: given || `{${name}}` });
    at = m.index + m[0].length;
  }
  if (at < body.length) parts.push(body.slice(at));
  return parts;
}
