type MonarchLanguage = import('monaco-editor').languages.IMonarchLanguage;
type MonarchRule = import('monaco-editor').languages.IMonarchLanguageRule;

// 0.56.0's TypeScript Monarch has no rule for `@` at all — not in `common`, and not in `symbols`
// (`/[=><!~?:&|+\-*\/\^%]+/`), so a decorator falls through to `defaultToken: "invalid"` and paints
// red. Java's own grammar already uses the `annotation` token for `@Foo`, so this reuses that name
// rather than inventing one. Returns a shallow clone: `javascript.js` is `tokenizer:
// language.tokenizer` — the *same object* as TypeScript's — so mutating in place would edit a
// module-level export shared by both registrations.
export function withDecorators(language: MonarchLanguage): MonarchLanguage {
  const common = language.tokenizer?.common;
  if (!common) return language; // upstream restructured the grammar — leave it alone, never throw
  const decoratorRule: MonarchRule = [/@[a-zA-Z_$][\w$]*/, 'annotation'];
  return {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      common: [decoratorRule, ...common],
    },
  };
}
