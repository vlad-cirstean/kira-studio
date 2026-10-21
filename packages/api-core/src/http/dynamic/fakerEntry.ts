// The Http module's own point of contact with `@faker-js/faker`, reached only through
// a dynamic `import()` in catalog.ts's `loadDynamicGenerator` — never a static import at the top
// of a module Vite includes in the boot bundle. This is a deliberate byte-for-byte twin of
// `views/grid/fakeData/fakerEntry.ts`, duplicated rather than shared: `http/**` may not
// import `views/**` (biome.json), and a second one-line entry module costs
// no extra chunk — Rolldown resolves both dynamic entries to the same `en` locale module and emits
// one shared chunk for it. The `/locale/en` subpath makes the single-locale intent explicit at the
// import (`en`'s locale data is one non-tree-shakeable ~415 KB object; a bare package
// import costs the same).
export { faker } from '@faker-js/faker/locale/en';
