/// <reference types="vite/client" />

// vite.config.ts's `define` — true for `wails3 dev`'s dev server and the build:dev/build:test
// bundles, false everywhere else (P29 F1). Gates main.ts's window.__kira* debug-hook install.
declare const __KIRA_DEBUG_HOOKS__: boolean;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

// C5 §9.4/D9: monaco-editor 0.56.0 ships a sibling .d.ts for every `register.js` (the language
// registration entry points, all typed already) but not for the Monarch data module itself
// (`<lang>.js`, e.g. `languages/definitions/javascript/javascript.js`) — views/repo/monacoEntry.ts
// dynamically imports this one directly (D9's JSON-reuses-JavaScript's-grammar trick), which is
// the only place this app reaches past a `register.js` boundary.
declare module 'monaco-editor/languages/definitions/javascript/javascript.js' {
  import type { languages } from 'monaco-editor';
  export const language: languages.IMonarchLanguage;
  export const conf: languages.LanguageConfiguration;
}

// D2 (P67c §2.2): same shape, `typescript.js` — monacoEntry.ts imports it directly so `withDecorators`
// (monarch/decorators.ts) can patch its `common` tokenizer rules before registering it.
declare module 'monaco-editor/languages/definitions/typescript/typescript.js' {
  import type { languages } from 'monaco-editor';
  export const language: languages.IMonarchLanguage;
  export const conf: languages.LanguageConfiguration;
}

// D1 (P67c §2.1): the worker-free JSON tokenizer monacoEntry.ts registers `json`'s tokens provider
// factory with — untyped for the same reason as the two declarations above (no sibling .d.ts ships
// for a module under `languages/features/*`, only for a `register.js` entry point).
declare module 'monaco-editor/languages/features/json/tokenization.js' {
  import type { languages } from 'monaco-editor';
  export function createTokenizationSupport(supportComments: boolean): languages.TokensProvider;
}

// P78 §1.4: monacoEntry.ts's own deep re-export of the standalone service-override seam — no
// sibling .d.ts ships for it either, same reasoning as the three declarations above. Typed to
// exactly the one method this app calls (`initialize`), not the whole internal surface.
declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    initialize(overrides: Record<string, unknown>): void;
  };
}
