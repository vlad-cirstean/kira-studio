import { z } from 'zod';
import { paletteColorSchema } from './color';
import type { AppMode } from './mode';
import { pathTail } from './tree';

// P103 Part 2 (§5.1): this file used to declare one 16-member `tabKindSchema` covering both apps
// — Kira Studio's 12 kinds and Kira Space's 5 (`terminal` shared between them). Neither app could
// ever render the other's kinds, so both carried unreachable stubs for them (Kira Studio's
// `unreachableTabKind`/`NeverRenderedTabView`, Kira Space's `kindDef` cast). Each app now declares
// its own kind union and per-kind state schemas in its own `state/tabDomain.ts`. This file keeps
// only what both apps' vocabularies genuinely share: the tab-record envelope fields below,
// `TabScope`, `pageSizeSchema`, `sortSpecSchema` (re-exported), `tabTitle`, and the one kind both
// apps really have — `terminal`, with its state schema.

// C5 D2/§4.1: TAB_KIND_MODE's value type widens from AppMode to TabScope — 'repo' is a sentinel
// meaning "this kind's workspace comes from the record's own workspaceId, never from the kind".
export type TabScope = AppMode | 'repo';

export { sortSpecSchema } from './queries';

export const pageSizeSchema = /*#__PURE__*/ z.union([
  z.literal(10),
  z.literal(100),
  z.literal(1000),
  z.literal(10000),
]);
export type PageSize = z.infer<typeof pageSizeSchema>;

// P1 D5-shaped envelope, common to every kind in both apps' own discriminated unions: id/
// connectionId/path/kind/state/order/active/workspaceId. Each app's own `state/tabDomain.ts`
// spreads this into its own `z.discriminatedUnion('kind', [...])` alongside its own kind literal
// and state schema per member — kept here, not duplicated per app, since the envelope itself
// never varies.
export const tabRecordBase = {
  id: z.string(),
  connectionId: z.string().nullable(),
  path: z.string(), // encoded NodePath, '' for a connection-scoped tab
  order: z.number().int(),
  active: z.boolean(),
  // C5 D2/§4.2: null for every studio/api tab (workspaceKeyOf's own `??` fallback derives the
  // workspace from `kind` instead) — 'repo:<code_repos.id>' for a tab scoped to that repository's
  // own workspace in Kira Studio; the bare repo id (or GENERAL_WORKSPACE) in Kira Space.
  workspaceId: z.string().nullable().default(null),
};

// P86 §4: which kind of launch a terminal tab is — 'claude-code' is the only kind that gets hooks
// (a session reporting its own activity) and the only kind the status-bar widget counts. Decided
// once at launch time by the caller (TabStrip.vue's producers), never inferred from `command`.
export const terminalLaunchKindSchema = /*#__PURE__*/ z.enum(['shell', 'claude-code', 'script']);
export type TerminalLaunchKind = z.infer<typeof terminalLaunchKindSchema>;

// P83 §7.1: minimal on purpose — a terminal tab's whole content is a live process (never
// persisted, §7.5), so state carries only what the tab's own title and dropResources path need
// without a second lookup: cwd (the pty's own directory) and codeRepoId (which workspace this
// terminal belongs to). P85 adds three fields, each defaulted so an older record still parses
// (terminal tabs are never persisted, but parseState runs on duplicateState's output too).
export const terminalTabStateSchema = z.object({
  cwd: z.string(),
  codeRepoId: z.string(),
  // P85: the command the shell runs at startup ($SHELL -l -i -c). '' is P83's plain login shell.
  command: z.string().default(''),
  // The tab's own title when set — a script's name, or 'Claude Code'. '' falls back to the cwd's
  // basename, exactly as P83 titled every terminal.
  label: z.string().default(''),
  color: paletteColorSchema.default('none'),
  // P86 §4: `.default('shell')` for the same already-saved-tab discipline as P85's own three
  // fields above — a terminal tab is never persisted, but parseState runs on duplicateState's
  // output too, so an older in-memory record still needs to parse.
  launchKind: terminalLaunchKindSchema.default('shell'),
});
export type TerminalTabState = z.infer<typeof terminalTabStateSchema>;

/** 'order_items' — the path tail's name; the connection name is rendered separately. Generic over
 *  any record carrying `kind`/`path`, since `TabRecord` itself is now per-app. */
export function tabTitle(record: { kind: string; path: string }): string {
  const tail = pathTail(record.path);
  // A console tab's path is often a container (connection root, database, schema) with no tail
  // name worth showing — 'Console' names the tab itself, same as a bare browser new-tab title.
  // Kira Space never has a 'console' kind, so this branch is inert there, not incorrect.
  if (record.kind === 'console') return tail?.name ?? 'Console';
  return tail?.name ?? record.path;
}
