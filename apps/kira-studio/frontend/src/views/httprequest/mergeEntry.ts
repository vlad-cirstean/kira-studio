// P8 D13: the sole point of contact with `@codemirror/merge`, reached only through a dynamic
// `import()` — never a static import at the top of a module Vite includes in the boot bundle.
// Matches views/console/sqlFormatterEntry.ts and the two fakerEntry.ts files (F15): a module
// whose only export is `await import('…')`. Memoised the same way every dynamic `import()` of the
// same specifier already is — the module system's own cache, not a second promise variable —
// so ResponseDiffDialog.vue's own await on mount costs a fetch only the first time anyone
// presses Compare in a session, exactly like *SQL Format* and *Generate data…* (D13).
export const loadMerge = () => import('@codemirror/merge');
