// C5 §9.1/§9.2: the sole contact point with `monaco-editor`, reached only through a dynamic
// `import()` inside monaco.ts's lazy initializer — never a static import at the top of a module
// Vite includes in the boot bundle. Static re-exports here, per sqlFormatterEntry.ts's own
// recorded measurement that an inline dynamic namespace import bundles worse.
//
// D7 correction (recorded here, not silently worked around): the plan's own `edcore.main.js` does
// not exist in the pinned 0.56.0 — that version's package restructured its internal layout
// entirely (`vs/basic-languages/<lang>/<lang>.contribution.js` moved to
// `vs/languages/definitions/<lang>/register.js`; the package's own `exports` map now exposes only
// `monaco-editor/*` -> `esm/vs/*.js`, so a deep `monaco-editor/esm/vs/...` import 404s outright).
// D7's own stated fallback path ("editor.api.js plus explicit contrib imports") turned out to have
// an exact, official equivalent in this version: `monaco-editor/features/register.all.js` is
// upstream's own "every standard contribution, no language services, no worker" bundle — verified
// against the source (it re-exports the identical contrib list `editor.main.js` inlines, minus
// every `languages/features/*` and `languages/definitions/*` import) — so this uses that bundle
// wholesale rather than hand-picking find/hover/folding/bracketMatching/links/wordHighlighter
// individually and risking a missed transitive dependency.
export * from 'monaco-editor/editor/editor.api.js';

import { languages } from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';

// §9.4's registered set — one import per language, each registering a lazy Monarch loader
// (registerLanguage's own `languages.registerTokensProviderFactory`, upstream's mechanism, not
// ours) so a language's own tokenizer data loads only once a file of that language is actually
// opened, on top of this chunk's own lazy load.
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/scss/register.js';
import 'monaco-editor/languages/definitions/less/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/dockerfile/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/graphql/register.js';
import 'monaco-editor/languages/definitions/protobuf/register.js';

// D9: Monaco ships no `languages/definitions/json` in this version either — its JSON coloring
// lives inside the excluded `vs/language/json` service. Registered here directly (rather than
// through upstream's own `registerLanguage` helper, which is internal to the definitions package)
// with the exact same lazy-loader shape: `.json`/`.jsonc` color with the JavaScript Monarch
// definition, loaded only once a JSON file is actually opened.
languages.register({ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON', 'json'] });
languages.registerTokensProviderFactory('json', {
  create: async () =>
    (await import('monaco-editor/languages/definitions/javascript/javascript.js')).language,
});

// P60a §4.2/§7 step 3: `kira-mongo`/`kira-redis` — two Monarch definitions this app owns, a direct
// transliteration of `editor/languages.ts`'s two hand-written `StreamLanguage`s (`mongoToken`/
// `redisToken`, kept there verbatim for P60b's console). No upstream grammar exists for either
// (`monaco-sql-languages` was checked and declined for SQL itself, §4.2 — a fortiori nothing
// covers a Mongo shell or a flat Redis command line), so this is the "no library for this job
// exists" case CLAUDE.md's library-first rule expects to be named, not a shortcut around it.
languages.register({ id: 'kira-mongo' });
languages.registerTokensProviderFactory('kira-mongo', {
  create: async () => (await import('./monarch/mongo')).mongoMonarchLanguage,
});

languages.register({ id: 'kira-redis' });
languages.registerTokensProviderFactory('kira-redis', {
  create: async () => (await import('./monarch/redis')).redisMonarchLanguage,
});

// D7's own one worker: backs `IEditorWorkerService` (C6's diff-editor widget computes its diff
// here), never a language-service worker — `vs/language/*` is never imported anywhere in this
// file, which is what keeps the typescript/json/css/html workers from ever existing.
export { default as EditorWorker } from 'monaco-editor/editor/editor.worker.js?worker';
