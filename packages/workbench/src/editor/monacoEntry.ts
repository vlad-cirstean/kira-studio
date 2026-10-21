// The sole contact point with `monaco-editor`, reached only through a dynamic
// `import()` inside monaco.ts's lazy initializer — never a static import at the top of a module
// Vite includes in the boot bundle. Static re-exports here, per sqlFormatterEntry.ts's own
// recorded measurement that an inline dynamic namespace import bundles worse.
//
// `edcore.main.js` does not exist in the pinned 0.56.0 — that version's package restructured its
// internal layout entirely (`vs/basic-languages/<lang>/<lang>.contribution.js` moved to
// `vs/languages/definitions/<lang>/register.js`; the package's own `exports` map now exposes only
// `monaco-editor/*` -> `esm/vs/*.js`, so a deep `monaco-editor/esm/vs/...` import 404s outright).
// The stated fallback path ("editor.api.js plus explicit contrib imports") turned out to have
// an exact, official equivalent in this version: `monaco-editor/features/register.all.js` is
// upstream's own "every standard contribution, no language services, no worker" bundle — verified
// against the source (it re-exports the identical contrib list `editor.main.js` inlines, minus
// every `languages/features/*` and `languages/definitions/*` import) — so this uses that bundle
// wholesale rather than hand-picking find/hover/folding/bracketMatching/links/wordHighlighter
// individually and risking a missed transitive dependency.

export type {
  CancellationToken,
  Environment,
  IDisposable,
  IEvent,
  IKeyboardEvent,
  IMarkdownString,
  IMouseEvent,
  IPosition,
  IRange,
  IScrollEvent,
  ISelection,
  ITrustedTypePolicy,
  ITrustedTypePolicyOptions,
  MarkdownStringTrustedOptions,
  Thenable,
  UriComponents,
} from 'monaco-editor/editor/editor.api.js';
export {
  CancellationTokenSource,
  Emitter,
  editor,
  KeyCode,
  KeyMod,
  languages,
  MarkerSeverity,
  MarkerTag,
  Position,
  Range,
  Selection,
  SelectionDirection,
  Token,
  Uri,
  // `worker` is declared in this module's own .d.ts but not actually bound in its esm .js (grep
  // confirms editor.api.js's own `export` statement omits it) — matching that mismatch exactly,
  // not adding a value export the runtime module doesn't provide.
} from 'monaco-editor/editor/editor.api.js';

import { languages } from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import { withDecorators } from './monarch/decorators';

// Upstream's own "every basic language" bundle, replacing what used to be 19
// individual `register.js` imports. Every grammar body still stays behind its own lazy `loader: ()
// => import(...)` inside its `register.js` (measured at ~15 KB raw for the 65 newly-added
// registrations, `register.all.js` itself is 81 one-line imports) — this only widens which
// extensions Monaco recognizes at all instead of falling back to `plaintext`. Two ids it also
// registers — `typescript`/`javascript` — are re-registered below with a patched tokenizer.
import 'monaco-editor/languages/definitions/register.all.js';

// 0.56.0 ships no `languages/definitions/json` — that grammar was, until now,
// borrowed from JavaScript's Monarch, which has one generic `string` rule and so colors every key
// and value identically. `languages/features/json/tokenization.js` is a real, worker-free
// `TokensProvider` (its only dependency is the bundled jsonc-parser scanner — no `jsonMode`, no
// `workerManager`, no `json.worker`, so the one-worker guard below is untouched) that tells
// `string.key.json` apart from `string.value.json`.
languages.register({ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON', 'json'] });
languages.registerTokensProviderFactory('json', {
  // `true` = tolerate comments: `.jsonc` shares this id, and a commented tsconfig.json is
  // ordinary. Strict JSON is unaffected — the scanner only ever *additionally* recognises them.
  create: async () =>
    (
      await import('monaco-editor/languages/features/json/tokenization.js')
    ).createTokenizationSupport(true),
});

// D2 (P67c §2.2): `typescript.js`/`javascript.js` share one tokenizer object by reference
// (`javascript.js`'s own `tokenizer: language$1.tokenizer`), and neither's `common` rule list nor
// its `symbols` regex (`/[=><!~?:&|+\-*\/\^%]+/`) matches `@` — a decorator falls through to
// `defaultToken: "invalid"` and paints red. `withDecorators` prepends one rule emitting `annotation`
// (matching Java's own grammar convention for `@Foo`) against a shallow clone, never the shared
// original. Registered here rather than left to `register.all.js`'s own `typescript/register.js` /
// `javascript/register.js` (imported above): `TokenizationRegistry.registerFactory` disposes
// whichever factory was registered for a language id first and keeps only the latest (verified
// against `tokenizationRegistry.js`'s own `registerFactory`), so ours must run *after* the
// `register.all.js` import above to be the one Monaco actually uses — the opposite of "first
// registration wins," which was this plan's own untested assumption. `languages.register()` is not
// repeated here: `register.all.js` already registered both ids with their full extension/alias/
// mimetype list, and a second call would only duplicate entries in that merged array. Language
// *configuration* (brackets, comments, auto-closing pairs) needs no duplicate call either —
// `register.all.js`'s own `typescript/register.js`/`javascript/register.js` already wired
// `languages.onLanguageEncountered(id, ...)` to load the same module and call
// `setLanguageConfiguration`, an independent registry from the tokenizer factory we override above.
languages.registerTokensProviderFactory('typescript', {
  create: async () =>
    withDecorators(
      (await import('monaco-editor/languages/definitions/typescript/typescript.js')).language,
    ),
});
languages.registerTokensProviderFactory('javascript', {
  create: async () =>
    withDecorators(
      (await import('monaco-editor/languages/definitions/javascript/javascript.js')).language,
    ),
});

// `kira-mongo`/`kira-redis` — two Monarch definitions this app owns, a direct
// transliteration of `editor/languages.ts`'s two hand-written `StreamLanguage`s (`mongoToken`/
// `redisToken`, kept there verbatim for the console). No upstream grammar exists for either
// (`monaco-sql-languages` was checked and declined for SQL itself — a fortiori nothing
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
