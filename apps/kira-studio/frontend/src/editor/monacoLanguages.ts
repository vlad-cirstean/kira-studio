import type { EditorLanguageId } from '@shared/domain/editor';

// P60a §4.2: the six `EditorLanguageId` values -> Monaco's own registered language ids. `json`,
// `xml`, `sql` are already registered Monarch languages (`monacoEntry.ts`); `plain` maps to
// Monaco's built-in `plaintext`; `mongo`/`redis` are this app's own two Monarch definitions
// (`views/repo/monarch/{mongo,redis}.ts`), registered under `kira-mongo`/`kira-redis` so they
// never collide with a future upstream `mongo`/`redis` grammar.
export function monacoLanguageIdFor(id: EditorLanguageId): string {
  switch (id) {
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'sql':
      return 'sql';
    case 'plain':
      return 'plaintext';
    case 'mongo':
      return 'kira-mongo';
    case 'redis':
      return 'kira-redis';
  }
}
