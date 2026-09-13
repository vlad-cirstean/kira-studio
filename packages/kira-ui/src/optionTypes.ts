/**
 * G21 D2: `KuiSegmentedOption`/`KuiSelectOption` live in a plain `.ts` module, not inside their
 * `.vue` SFCs' own `<script setup>` blocks, because `apps/kira-studio-vscode`'s own `tsgo` check
 * (unlike `vue-tsc`) resolves `.vue` imports through a generic `declare module '*.vue'` ambient
 * shim (`env.d.ts`) that only declares a default export — a named type export from a `.vue` file
 * type-checks fine under `vue-tsc` but is invisible to that shim, and `@kira/git-ui`'s own
 * `src/index.ts` (which `main.ts` imports) re-exports `@kira/kira-ui`'s whole surface, pulling
 * this in transitively.
 */

export interface KuiSegmentedOption {
  id: string;
  icon: string;
  label: string;
  badge?: number;
}

export interface KuiSelectOption {
  value: string;
  label: string;
}
