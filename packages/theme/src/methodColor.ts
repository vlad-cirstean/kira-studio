import type { MethodToken } from '@shared/domain/http';

// P110 B29: the method-chip colour, folded into these existing conn-* colour utilities --
// --kira-method-* each already alias the matching --kira-conn-* (tokens.css:197-204), so no new
// @theme entry is needed, just the existing rung-2 utility. Written out in full so Tailwind's
// static scanner finds each literal class name; a template literal like `text-conn-${x}` would
// never resolve, since nothing in source spells the whole string.
const METHOD_TEXT_CLASS: Record<MethodToken, string> = {
  get: 'text-conn-blue',
  post: 'text-conn-green',
  put: 'text-conn-amber',
  patch: 'text-conn-violet',
  delete: 'text-conn-red',
  head: 'text-conn-teal',
  options: 'text-conn-cyan',
  other: 'text-conn-grey',
};

export function methodTextClass(token: MethodToken): string {
  return METHOD_TEXT_CLASS[token];
}
