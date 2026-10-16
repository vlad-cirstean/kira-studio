# P98 — shadcn-vue, Tailwind, VueUse, Pinia, TanStack Query as standing deps; Vue conventions in `CLAUDE.md`

`docs/v1.9/SPEC.md`'s P98 row, turned into concrete steps. Planned against `v1.9` at `fd36fe8`
(P97 landed). Prep only: dependencies, bootstrap wiring, conventions. No existing `.vue` file,
store or stylesheet is migrated — that is P99.

Every version, file path, count and config fact below was measured in this container against
`fd36fe8` (registry versions read with `npm view` on 2026-09-21; repo state read through CodeGraph
plus the config files it does not index). §1 records the one place the SPEC row's own framing is
already out of date.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| "Tailwind's CSS entry point and build/config wiring" | **Already wired — nothing to bootstrap.** `apps/kira-studio/frontend/vite.config.ts` loads `@tailwindcss/vite` (4.3.3) and `src/theme/base.css` starts with `@import "tailwindcss"` plus a `@theme` block mapping `--kira-*` onto Tailwind colour/radius utilities. Preflight is live (`TitleBar.vue` and `RepoFileView.vue` both comment on it). P98 adds only the two pieces that are genuinely missing: `clsx` + `tailwind-merge` and a `cn()` helper | §1.2, §3 |
| Which Vite build gets the libraries? | **`apps/kira-studio/frontend` only.** `packages/git-ui` is a second, independent Vite build (`packages/git-ui/vite.config.ts`) targeting the VS Code webview, with its own `--kv-*`/`--kui-*` token vocabulary and no Tailwind. P100 extracts it into another app outright | §2.4 |
| Where do the new deps go? | **Root `package.json` `dependencies`.** The repo's own precedent for app runtime libraries: `monaco-editor`, `slickgrid`, `fuzzysort`, `markdown-it`, `@floating-ui/dom`, `@xterm/*` all sit there while `apps/kira-studio/frontend/package.json` carries only `workspace:*` entries | §2.2 |
| Does a component get generated here? | **No.** SPEC says bootstrap plumbing only. `bunx shadcn-vue add …` runs for the first time in P99 | §4.4, §13 |
| Then what keeps `knip` green? | **Explicit, documented `knip.json` entries.** `bun run lint:dead` runs in the pre-push hook, and a dependency nothing imports yet is exactly what it flags. `knip.json` already carries this shape of exception for `tailwindcss`. P98 adds entries for the deliberately-unconsumed surface and states P99's obligation to delete them | §8 |
| What does shadcn-vue's palette bind to? | **`--kira-*`, not shadcn's default neutral ramp.** `init` writes its own literal colour ramp; P98 moves that block into `src/theme/shadcn-bridge.css` and replaces every value with the matching `--kira-*` token, exactly as `kui-bridge.css`/`vscode-bridge.css` already bridge this app's tokens onto another vocabulary | §4.3 |
| Light mode? | **No `.dark` block.** `src/theme/tokens.css` is a single `:root`, VS Code Dark Modern derived, no media query; `index.html` hardcodes `<html class="dark">`. The shadcn vars are defined once under `:root` | §4.3 |
| Is a `@/` path alias needed? | **Yes.** shadcn-vue generates components that import `@/lib/utils`. The alias lands in P98 (Vite `resolve.alias` + frontend `tsconfig.json` `paths`) so P99's first `add` typechecks. Existing files keep their relative imports | §4.2 |
| Pinia store scope in this phase | **Zero stores.** Only `createPinia()` registered at bootstrap. A store with no consumer is migration work and would itself be dead code | §5 |
| One subagent or several? | **One sequential.** Seven small commits on one dependency chain: deps → bootstrap → alias → shadcn → docs. Nothing fans out | §11 |

---

## 1. Confirmed current state

### 1.1 Build and workspace layout

- Bun workspaces (`bun` 1.3.11). Root `package.json` `workspaces`: `apps/*/frontend`,
  `apps/kira-studio-vscode`, `packages/{shared,api-core,git-ipc,git-core,git-ui,kira-ui}`.
- Two Vite builds: `apps/kira-studio/frontend/vite.config.ts` (Wails webview, `vue()` +
  `tailwindcss()`, aliases `@shared`, `@bindings`, `@bindings-internal`) and
  `packages/git-ui/vite.config.ts` (VS Code webview, `vue()` only).
- `vue` 3.5.42, `vite` 8.3.0, `typescript` 6.0.3, `@vitejs/plugin-vue` 6.0.9 — all root
  devDependencies.
- App entry: `apps/kira-studio/frontend/index.html` → `src/main.ts`. `main.ts:335` is the single
  mount line: `createApp(App).directive('tooltip', vTooltip).mount('#app')`, called at the end of
  `bootstrap()` after a `Promise.all` of 14 hydrate calls.
- `index.html` CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'`. No CDN, so every
  library must bundle. Reka UI positions through inline styles, which `'unsafe-inline'` already
  permits — no CSP change.

### 1.2 Tailwind is already bootstrapped (the SPEC row's own list is stale here)

`src/theme/base.css`, verbatim first line: `@import "tailwindcss";`. Its `@theme` block already
maps 24 tokens (`--color-bg: var(--kira-bg)`, `--color-muted: var(--kira-fg-muted)`, the 12
`--color-conn-*`, four `--radius-kira*`). `biome.json` sets `css.parser.tailwindDirectives: true`.
`knip.json` already ignores `tailwindcss` as CSS-only.

So the SPEC row's "Tailwind's CSS entry point and build/config wiring" is a no-op. What is missing
is only the class-merging pair the row names alongside it (`clsx`, `tailwind-merge`) and the `cn()`
helper shadcn-vue components import.

### 1.3 State management today: 39 hand-rolled `reactive()` modules, no Pinia

`apps/kira-studio/frontend/src/state/` holds 39 `.ts` modules. The shape is uniform — a
module-level `reactive({…})` plus exported functions:

- `state/settings.ts`: `export const settingsState = reactive<Settings>(…)`, `settingsOpen = ref(false)`.
- `state/maskRules.ts`: `reactive({ byConnection, correlationKeys, counts })` + `loadMaskRules`/
  `upsertMaskRule`/`removeMaskRule`.
- `state/schemas.ts`: `schemasState` + `schemaDialogState` in one module.

Nothing imports `pinia` anywhere in the repo. P98 registers the instance; P99 splits and converts.

### 1.4 Data fetching today: manual cache/dedupe/loading by hand

Three measured patterns, all of them what TanStack Query exists to replace:

- `state/schemas.ts:38` `ensureDdl` — a hand-written in-flight `Map<string, Promise<string>>`,
  a cache check, a race guard against a fresher write, and a `finally` that evicts a rejected
  promise. 30 lines of comment explaining the cache semantics.
- `state/maskRules.ts` — fetch-then-write-into-`reactive`, with each mutation re-calling the
  loader.
- `views/grid/PreviewCommandPanel.vue:15` — `ref([])` + `loading = ref(true)` + `error = ref(null)`,
  the per-component shape. 22 `.vue` files under `src/` mention `loading`.

P98 wires the client and the plugin only. No call site moves.

### 1.5 Component style today

200 `.vue` files across `apps/kira-studio/frontend/src`, `packages/git-ui/src`,
`packages/kira-ui/src`. Measured:

- Every one of the 200 has a `<script setup>` block. No Options API, no `defineComponent` anywhere.
- `views/httprequest/FieldRowsTable.vue` is the only file whose opening tag is not literally
  `<script setup lang="ts">` — it is a multi-line `<script setup lang="ts" generic="…">`, the same
  rule.
- Two files carry a second, plain `<script lang="ts">` block beside `<script setup>`:
  `views/repo/RepoTerminalView.vue` and `packages/git-ui/src/components/SearchResults.vue`.

So the `<script setup lang="ts">`-only rule codifies what the repo already does; it is not a
migration trigger. The two dual-block files are P99's call, not P98's.

### 1.6 The gates this phase has to stay green against

- **pre-commit** (`.githooks/pre-commit`): `bun run lint` (Biome + `scripts/check-tokens.sh`) and
  `bun run typecheck` (five projects, including `vue-tsc` on the frontend).
- **pre-push** (`.githooks/pre-push`): `go build ./...`, `bun run lint:go`, `bun run lint:dead`
  (knip). **knip is a push gate** — §8 exists for this reason.
- `scripts/check-tokens.sh` fails if any `var(--kira-…)` in `apps/kira-studio/frontend/src` has no
  definition in `theme/tokens.css`, `theme/base.css` or `theme/primitives.css`. The new bridge file
  is inside that tree, so every token §4.3 names must already exist. All of them do — verified
  against `tokens.css` (`--kira-radius*` at lines 63-66, `--kira-conn-*` at 175-186).
- No bundle-size budget test exists (`tests/ui/budgets.spec.ts` measures render timings only), so
  the added weight is not a gated number.

---

## 2. The dependency set

### 2.1 Versions and licences (read from the registry, not guessed)

| Package | Version | Licence | Role | Bootstrap? |
|---|---|---|---|---|
| `pinia` | 4.0.3 | MIT | Client state stores | §5 |
| `@tanstack/vue-query` | 5.103.2 | MIT | Server state | §6 |
| `@vueuse/core` | 15.0.0 | MIT | DOM/browser composables | none (SPEC says so) |
| `clsx` | 2.1.1 | MIT | Class concatenation | §3 |
| `tailwind-merge` | 3.7.0 | MIT | Tailwind conflict resolution | §3 |
| `reka-ui` | 2.10.5 | MIT | shadcn-vue's headless primitives | installed by `init` |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | shadcn-vue variant props | installed by `init` |
| `lucide-vue-next` | 1.0.0 | ISC | shadcn-vue's icon set | installed by `init` |
| `tw-animate-css` | 1.4.0 | MIT | shadcn-vue's enter/exit animations | installed by `init` |

All fully open source, no dual-licensed tier, no paid feature gate — `CLAUDE.md`'s licence rule
checked at package level for each.

Peer dependencies verified against `vue` 3.5.42 / `typescript` 6.0.3: `pinia` wants
`vue ^3.5.11` + `typescript >=5.6.0`, `@vueuse/core` `vue ^3.5.0`, `reka-ui` `vue >= 3.4.0`,
`@tanstack/vue-query` `vue ^2.6.0 || ^3.3.0`. All satisfied. `pinia` also peers
`@vue/devtools-api`; if `bun install` prints a peer warning for it, record the exact line in the
result section — do not add the package to silence it.

`shadcn-vue` (2.8.2) is **not** installed. It is a generator, run as `bunx shadcn-vue@2.8.2`; a
dependency entry for it would be dead weight and a knip finding.

### 2.2 Where they land

Root `package.json` `dependencies`, alphabetically merged into the existing block, matching the
`monaco-editor`/`slickgrid` precedent (§0). The shadcn-vue CLI writes into whatever `package.json`
its `--cwd` resolves to; §4.1 moves those entries up to the root and re-runs `bun install`.

`bun.lock` changes in the same commit. Outbound HTTPS goes through this container's agent proxy —
if `bun install` fails TLS or gets a 407, see `/root/.ccr/README.md`; never disable verification.

### 2.3 Declined here, with reasons

- `@tanstack/vue-query-devtools` — a dev-only overlay nothing in this app's bootstrap would show.
  P99 can revisit.
- `pinia-plugin-persistedstate` — this app persists through the Go side (`control.*`), not
  `localStorage`. No requirement.
- `@vueuse/components` / `@vueuse/integrations` — the SPEC row names VueUse's composables. Extra
  entry points with no consumer.
- `tailwindcss-animate` — superseded by `tw-animate-css` for Tailwind v4, which is what shadcn-vue
  2.8 installs.

### 2.4 Not wired into `packages/git-ui` or `packages/kira-ui` — stated, not forgotten

Neither package gets Tailwind, shadcn-vue, Pinia or Query in this phase:

1. `packages/git-ui` is a separate bundle for the VS Code webview, themed through `--vscode-*`/
   `--kv-*` and bridged from two different hosts. Dropping Tailwind preflight into it would reset
   webview chrome this repo does not own the styling contract for.
2. `packages/kira-ui` is the hand-rolled primitive layer (`KuiButton`, `KuiDialog`,
   `KuiContextMenu`, …) that shadcn-vue is a candidate to replace outright — wiring Tailwind into
   it now would pre-commit P99 to keeping it.
3. P100 extracts the whole git module, `packages/git-ui` included, into a separate app.

P99's planning pass decides whether its "every `.vue` file" scope reaches those two packages. P98
does not decide it for them; it only records that the bootstrap it lands does not cover them.

---

## 3. Tailwind: `clsx` + `tailwind-merge` + `cn()`

Nothing to configure (§1.2). Two deps, one helper file — and the helper file is what `init`
generates in §4, so this section's only standalone work is the dependency entries.

`src/lib/utils.ts`, as shadcn-vue writes it:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

If the generated file lacks the explicit `: string` return type, add it —
`verbatimModuleSyntax`/`strict` are on and the repo's own style annotates exported returns.

---

## 4. shadcn-vue

### 4.1 Init

Run from the frontend workspace so the CLI detects Vite, Tailwind v4 and `bun`:

```sh
cd apps/kira-studio/frontend
bunx shadcn-vue@2.8.2 init -y -d --template vite --base reka --icon-library lucide \
  --base-color neutral --css-variables
```

`-d` takes defaults; `--base-color neutral` is immaterial (every value is replaced in §4.3) and is
pinned only so the run is reproducible. The version is pinned, not `@latest`, so a later session
reproduces this exact output.

Then, in order:

1. `git status` — the CLI writes `components.json`, `src/lib/utils.ts`, a CSS block, and dependency
   entries. Review each before keeping it.
2. Move any dependency entries it added to `apps/kira-studio/frontend/package.json` up into the
   root `package.json` `dependencies`, leaving that workspace's file with only its `workspace:*`
   entries. Re-run `bun install` from the repo root.
3. Edit `components.json` to the values in §4.2.
4. Move the CSS it emitted per §4.3.
5. `bun run format` over the generated files — the CLI's output is not Biome-formatted (single
   quotes, 100-column width, `organizeImports`).

**Read the files the CLI actually produced.** The JSON in §4.2 and the variable list in §4.3
describe 2.8.2's output as of this plan; if what lands differs, follow the real file and record the
difference in the result section. P97's own deviation #2 is the precedent: read the tree, not the
plan's transcription of it.

### 4.2 `components.json` and the `@/` alias

Target values (illustrative shape — keep whatever additional keys the CLI writes):

```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "typescript": true,
  "tsConfigPath": "./tsconfig.json",
  "tailwind": {
    "config": "",
    "css": "src/theme/shadcn-bridge.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "composables": "@/composables",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  },
  "iconLibrary": "lucide"
}
```

`tailwind.config` stays `""` — Tailwind v4 is CSS-first, there is no config file and §1.2 confirms
none exists. `tailwind.css` points at the bridge file (§4.3), so a later `add` that needs a new
variable writes it beside the others instead of into `base.css`.

The `@/` alias needs both halves, or `vue-tsc` and the build disagree:

- `apps/kira-studio/frontend/vite.config.ts`, in `resolve.alias`, beside the three existing
  entries: `'@': fileURLToPath(new URL('./src', import.meta.url))`.
- `apps/kira-studio/frontend/tsconfig.json`, in `compilerOptions.paths`:
  `"@/*": ["./src/*"]`.

Existing source keeps its relative imports; `@/` is for generated components. Biome's
`noRestrictedImports` layering overrides are glob patterns over the specifier (`**/workbench/**`,
`**/views/**`), so an `@/workbench/…` import still matches them — the §11 layering rules are not
weakened by the alias.

### 4.3 `src/theme/shadcn-bridge.css` — the token bridge

Take the block `init` wrote (its `:root` variables, its `@theme inline` mapping, its
`@custom-variant dark`, its `@import "tw-animate-css"`) out of wherever it landed and into a new
`src/theme/shadcn-bridge.css`. Restore `base.css` to its pre-init content plus one line, placed
with the other imports at the top, after `./kui-bridge.css`/`./vscode-bridge.css` since it is the
same kind of file:

```css
@import "./shadcn-bridge.css";
```

Keep the `@theme inline` and `@custom-variant dark` blocks exactly as generated. Delete any `.dark`
selector block the CLI emits and keep a single `:root` — `tokens.css` is one `:root` with no media
query and `index.html` hardcodes `class="dark"` (§0), so a second copy would be two names for one
palette.

Replace every literal colour/length with the matching token:

| shadcn variable | Value |
|---|---|
| `--background` | `var(--kira-bg)` |
| `--foreground` | `var(--kira-fg)` |
| `--card`, `--popover` | `var(--kira-bg-elevated)` |
| `--card-foreground`, `--popover-foreground` | `var(--kira-fg)` |
| `--primary` | `var(--kira-accent)` |
| `--primary-foreground` | `var(--kira-accent-fg)` |
| `--secondary` | `var(--kira-bg-input)` |
| `--secondary-foreground` | `var(--kira-fg)` |
| `--muted` | `var(--kira-bg-input)` |
| `--muted-foreground` | `var(--kira-fg-muted)` |
| `--accent` | `var(--kira-hover)` |
| `--accent-foreground` | `var(--kira-fg)` |
| `--destructive` | `var(--kira-error)` |
| `--destructive-foreground` | `var(--kira-accent-fg)` |
| `--border` | `var(--kira-border)` |
| `--input` | `var(--kira-border-strong)` |
| `--ring` | `var(--kira-focus)` |
| `--radius` | `var(--kira-radius)` |
| `--chart-1` … `--chart-5` | `var(--kira-conn-blue)`, `-green`, `-amber`, `-violet`, `-teal` |
| `--sidebar` | `var(--kira-bg-chrome)` |
| `--sidebar-foreground`, `--sidebar-accent-foreground` | `var(--kira-fg)` |
| `--sidebar-primary` | `var(--kira-accent)` |
| `--sidebar-primary-foreground` | `var(--kira-accent-fg)` |
| `--sidebar-accent` | `var(--kira-hover)` |
| `--sidebar-border` | `var(--kira-border)` |
| `--sidebar-ring` | `var(--kira-focus)` |

Two mappings are judgment calls, so comment each in the file:

- **`--accent` is not `--kira-accent`.** shadcn's `--accent` is the hover/active surface behind a
  menu row, not the brand colour; `bg-accent` on every menu item would paint the app blue. Brand
  accent is `--primary`.
- **`--input` is `--kira-border-strong`, not `--kira-bg-input`.** shadcn spends `--input` mostly as
  `border-input` on form controls. The background use (`bg-input/30`) is the minority case, and
  `--kira-bg-input` is available to P99 through `bg-input` — Tailwind's own utility from `base.css`'s
  existing `@theme` — when a filled control needs it.

Any variable `init` emits that this table does not name gets the nearest token by the same
reasoning, and a one-line comment saying which. Never leave a literal hex: `check-tokens.sh` will
not catch it, but the single-source-of-truth rule the other two bridge files state does.

Keep the `@import "tw-animate-css";` line the CLI writes — shadcn's dialog/dropdown/popover markup
uses its `animate-in`/`fade-in` utilities, and P99's first `add` needs them working.

File header comment, matching `kui-bridge.css`'s own opening: what it bridges, that every
right-hand side is an existing `--kira-*` token, and that nothing imports a shadcn-vue component
yet (P99 is the first consumer).

### 4.4 No component is generated

`bunx shadcn-vue add …` is not run in this phase. A generated `src/components/ui/button/` with no
importer is dead code knip reports and a design decision (which primitive, which variants) that
belongs to P99's own inventory pass. §12's verification proves the wiring instead, through
typecheck and build.

---

## 5. Pinia bootstrap

New file `apps/kira-studio/frontend/src/state/pinia.ts`:

```ts
import { createPinia } from 'pinia';

// P98: the app's one Pinia instance, exported rather than created inline in main.ts so a unit
// test can `setActivePinia(pinia)` before touching a store defined outside a component.
export const pinia = createPinia();
```

`src/state/` is the right home: `main.ts` already imports 14 modules from there, and the Biome
layering overrides for `state/**` ban only `views/httprequest/**`/`views/grpcrequest/**`.

No store is defined (§0). P99 adds the first one.

## 6. TanStack Query bootstrap

New file `apps/kira-studio/frontend/src/state/queryClient.ts`:

```ts
import { QueryClient } from '@tanstack/vue-query';

// P98: exported so non-component code can invalidate (P99's migration target) — main.ts hands it
// to VueQueryPlugin rather than letting the plugin construct its own.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every query in this app resolves over the Wails bridge to the local Go process, not the
      // network: a failure is a real backend/engine error (bad SQL, dead connection), not a
      // transient one worth repeating.
      retry: false,
      // The app is a desktop window whose data changes when the user acts or the backend pushes
      // (control.on*Changed), never because the window regained focus.
      refetchOnWindowFocus: false,
    },
  },
});
```

`main.ts` (currently one chained line at `main.ts:335`) becomes:

```ts
const app = createApp(App);
app.use(pinia);
app.use(VueQueryPlugin, { queryClient });
app.directive('tooltip', vTooltip);
app.mount('#app');
```

Imports: `import { VueQueryPlugin } from '@tanstack/vue-query';`, `import { pinia } from
'./state/pinia';`, `import { queryClient } from './state/queryClient';`. Biome's
`organizeImports` assist decides their order — run `bun run format`, do not hand-place them.

Keep the mount where it is: after the `Promise.all` hydration block and before `initAppUpdate()`.
Both plugins are synchronous registrations; neither belongs on the awaited boot path.

Per-query `staleTime`, `gcTime` and key conventions are deliberately not set globally — they are a
per-call-site decision P99 makes with the migrated code in front of it.

## 7. VueUse

Dependency only, per the SPEC row. No plugin, no `app.use`, no composable imported here. §8 covers
the knip consequence.

---

## 8. Keeping `knip` green, and P99's obligation to undo it

`bun run lint:dead` is a pre-push gate (§1.6). After §2-§6, four things are unconsumed:

| Unconsumed | Why it exists now | First consumer |
|---|---|---|
| `@vueuse/core` | SPEC: dependency with no bootstrap step | P99 |
| `reka-ui`, `class-variance-authority`, `lucide-vue-next`, `tw-animate-css` | `init` installs shadcn-vue's component runtime; `add` needs all four | P99's first `add` |
| `clsx`, `tailwind-merge` | Consumed by `src/lib/utils.ts`, which nothing imports yet | P99 |
| `src/lib/utils.ts` | Generated by `init`; its importer is a generated component | P99 |

Add to `knip.json`:

- `ignoreDependencies`: the seven package names above, under one comment block naming P98, saying
  each is bootstrap for P99, and saying P99 deletes the entry when its first consumer lands. The
  existing `tailwindcss` entry is the same exception in the same file — CSS-only rather than
  not-yet-imported, but the same "real dependency knip's import graph cannot see" case.
- `workspaces["apps/kira-studio/frontend"].ignore`: `["src/lib/utils.ts"]`, with the same reason.

Uninstalling the four `init` deps now and reinstalling them in P99 was considered and declined: it
churns `bun.lock` twice for no verification gain, and `add` would reinstall them at whatever version
resolves then instead of the ones this plan pins.

`knip.json` is JSON-with-comments (`biome.json` already grants it `allowComments`), so the reasons
live in the file rather than only in the commit.

---

## 9. `CLAUDE.md` — the three standing rules

Insert as three bullets in the main process list, **immediately after** the existing bullet that
starts "**Reach for an existing, well-maintained library before hand-rolling non-trivial
infrastructure**" and before the "**Only fully open-source libraries**" bullet — the first is the
general rule these three specialise, the second is the constraint they were chosen under. Wrap at
100 columns, terse style, no other bullet touched:

```markdown
- **Lean on the frontend libraries P98 wired in — shadcn-vue, Tailwind CSS, VueUse, Pinia, TanStack
  Query — rather than hand-rolling an equivalent.** Every phase's planning pass adapts its design to
  them, whether or not the spec row asking for the work says so: a new UI surface styles with
  Tailwind utility classes, not a scoped `<style>` block; a component primitive (button, dialog,
  dropdown, menu, popover) comes from shadcn-vue; a browser/DOM composable (debounce, resize and
  intersection observers, event-listener wiring, local-storage sync, clipboard) comes from VueUse;
  shared client state lives in a Pinia store; server state — anything fetched over the bridge with
  loading, error and cache handling around it — goes through TanStack Query. Decline one only
  against a real requirement it cannot meet, and name that requirement, same standard as the
  library rule above.
- **Every Vue component is `<script setup lang="ts">`.** Composition API only — no Options API, no
  `defineComponent`, no second plain `<script>` block.
- **One Pinia store, one concern.** A store owns a single subsystem's state; never a grab-bag
  app-wide store. Split one that grows a second concern rather than widening it.
```

Nothing is removed from `CLAUDE.md` in this phase — checked the file for a bullet these three make
stale, and there is none.

## 10. `docs/ARCHITECTURE.md`

`CLAUDE.md`'s split puts app facts here. Add to the **`## Stack`** section (read the section and
place by content — do not trust a line number, per P97's own deviation #2) a short list: Vue 3.5 +
Vite, Tailwind v4 CSS-first with `--kira-*` bridged in `theme/base.css`, shadcn-vue on Reka UI with
its palette bridged in `theme/shadcn-bridge.css`, Pinia for client state, TanStack Query for server
state, VueUse for DOM composables — and the one-line fact that P98 wired them and P99 migrates onto
them.

No **Known open items** entry: nothing here is a limitation, and "P99 hasn't run yet" is a phase in
`SPEC.md`, not an open item.

---

## 11. Commits

One sequential subagent. Seven commits, in this order — each leaves `bun run lint` and
`bun run typecheck` green (the pre-commit gate); knip is checked once at push (§12).

1. `chore(deps): add Pinia, TanStack Query and VueUse` — root `package.json`, `bun.lock`,
   `knip.json`'s `@vueuse/core` entry.
2. `feat(frontend): register Pinia and TanStack Query at app bootstrap` — `src/state/pinia.ts`,
   `src/state/queryClient.ts`, `src/main.ts`.
3. `chore(frontend): add the @/ source alias` — `vite.config.ts`, `tsconfig.json`.
4. `feat(frontend): bootstrap shadcn-vue on the --kira-* token set` — `components.json`,
   `src/lib/utils.ts`, `src/theme/shadcn-bridge.css`, `src/theme/base.css`, root `package.json`,
   `bun.lock`, the rest of `knip.json`.
5. `docs: require Tailwind, shadcn-vue, VueUse, Pinia and TanStack Query in new work` — `CLAUDE.md`.
6. `docs: record the frontend library baseline` — `docs/ARCHITECTURE.md`.
7. `docs(v1.9): record P98` — the `## P98 result` section in `docs/v1.9/SPEC.md`.

Commit 7 follows P96's and P97's own result sections: commits in order, what landed, every
deviation from this plan, and §12's measured numbers. State plainly if a step found nothing to do
(the Tailwind wiring of §1.2, most likely) rather than inventing work for it.

`--no-verify` is not an ending. A red hook gets root-caused and fixed, and the shipped commit
passes it clean.

## 12. Verification

Run after commit 6, before commit 7. Baselines are P97's own result section.

| Command | Expected |
|---|---|
| `bun install` | Clean. Record any peer warning verbatim (§2.1) |
| `bun run typecheck` | Clean, all five projects — this is what proves the `@/` alias and `vue-tsc`'s view of it agree |
| `bun run build` | Clean. The frontend bundle now carries Pinia + Query; no new Vite warning |
| `bun run build:vscode` | Clean and **unchanged in content** — `packages/git-ui` is untouched (§2.4) |
| `bun run lint` | Biome 0 errors/0 warnings/0 infos; `check-tokens` reports every `--kira-*`, `--kv-*`, `--kui-*` reference resolving — the bridge file's own proof (§1.6) |
| `bun run lint:dead` | knip clean but for the declared `duplicates` warnings (unchanged). A new finding means §8's entries are wrong — fix the entry, never the rule level |
| `bun run test:unit` | 1535 passed, 0 failed |
| `bun run test:webview` | 55 passed, 0 failed |
| `bun run test:ui` | 311 total. A failure isolates with `--workers=1` and dates with `git diff --stat fd36fe8` before it is called contention rather than a regression — P96 established that method and P97 reused it |

Go is untouched by this phase, so `go build`/`go test` are the pre-push hook's job, not a step here.

Two targeted checks beyond the suites, because §4's output is generated rather than written:

1. **The bridge actually applies.** In the built app (or `bun run dev`), evaluate
   `getComputedStyle(document.documentElement).getPropertyValue('--background')` — it must resolve
   to `--kira-bg`'s `#1f1f1f`, not shadcn's neutral default. A bridge file that is written but never
   imported fails silently and would only surface in P99.
2. **`cn()` is reachable through the alias.** `bunx shadcn-vue@2.8.2 add button --dry-run` from
   `apps/kira-studio/frontend` must resolve `components.json`, the alias and `@/lib/utils` without
   error. `--dry-run` writes nothing, so this proves P99's entry point without landing a component
   (§4.4). If the CLI has no working `--dry-run` in this version, add `button`, confirm it
   typechecks, then `git checkout` the generated files — and say so in the result section.

## 13. Deliberately out of scope — confirmed, not forgotten

- **Any `.vue` file.** No component, store, stylesheet or fetch call is migrated. That is P99, and
  P99's own "one touch per file" rule is why P98 must not pre-touch anything.
- **Any shadcn-vue component.** §4.4.
- **Any Pinia store.** §5.
- **`packages/git-ui`, `packages/kira-ui`, `apps/kira-studio-vscode`.** §2.4.
- **The 255 `a11y` findings and `biome.json`'s `**/*.vue` override.** P101, sequenced after P99.
- **`src/theme/base.css`'s existing `@theme` block.** It stays exactly as it is; shadcn's variables
  are additive and use different names (`--color-background` vs `--color-bg`). The apparent overlap
  is two vocabularies over one palette, which is the same thing `kui-bridge.css` already does.
- **The two dual-`<script>` files** (§1.5). The new convention covers them, but rewriting them is a
  file touch P99 owns.
