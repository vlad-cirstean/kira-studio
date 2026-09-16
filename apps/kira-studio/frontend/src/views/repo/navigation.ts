// C6 §8.2: the definition/hover providers plus the cross-file editor opener — one scheme-scoped
// selector covers every open repo-file/repo-diff model, in every one of the nineteen registered
// languages plus plaintext, since a `LanguageFilter` with `scheme` set and no `language` scores 10
// for any model in that scheme (verified against monaco-editor/esm/vs/editor/common/
// languageSelector.js at the pinned 0.56.0).
//
// This lives in its own module, not monaco.ts, because it needs `openRepoFileTab` from
// state/repoTabs.ts, and state/tabKinds.ts already imports views/repo/editors.ts, which imports
// views/repo/monaco.ts — putting the import there would close a module cycle (tabKinds -> editors
// -> monaco -> repoTabs -> tabs -> tabKinds). Only the two mounted views import this module, so the
// existing edges stay acyclic.
import type { NavResult, NavTarget, RefResult } from '@shared/domain/repo';
import { control } from '../../bridge/control';
import { type NavStatusState, publishNavStatus } from '../../state/navStatus';
import { openRepoFileTab } from '../../state/repoTabs';
import type { MonacoModule } from './monaco';
import { repoFileUriObject, repoLocationOf } from './monaco';

let registered = false;

const SELECTOR = { scheme: 'kira-repo', hasAccessToAllModels: true } as const;

async function resolve(
  model: import('monaco-editor').editor.ITextModel,
  position: import('monaco-editor').Position,
): Promise<NavResult | null> {
  const loc = repoLocationOf(model);
  if (!loc) return null; // D7: no location recorded — the diff's own HEAD side, deliberately.
  return control.codeWorkspaceDefinitions(
    loc.repoId,
    loc.path,
    position.lineNumber,
    position.column,
  );
}

function renderTargetLine(t: NavTarget): string {
  // internal/repomap/render.go's own shape, carried into the UI: location, then rule/confidence —
  // printed on every line, not only a low-confidence one, so a repoWide guess never reads like a
  // fact by omission.
  return `${t.path}:${t.startLine} (${t.confidence}, ${t.rule})`;
}

function renderHoverMarkdown(res: NavResult): string {
  const lines: string[] = [];
  const first = res.targets[0];
  lines.push(`**${first.kind}** \`${res.name}\``);
  for (const t of res.targets) lines.push(renderTargetLine(t));
  // Printed always, the same discipline render.go's own renderTargetLine follows for Rule/
  // Confidence: name resolution here is never type resolution, worth saying on every hover. §5.1's
  // own receiver tiebreak is a real Go relationship, not name proximity, so it earns its own line
  // instead of the blanket disclaimer once every target was ranked that way.
  lines.push(
    res.targets.every((t) => t.rule === 'sameReceiver')
      ? '_Receiver-matched (Go) — signatures are not compared._'
      : '_Name-resolved, not type-resolved._',
  );
  return lines.join('\n\n');
}

function rangeOf(s: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}) {
  return {
    startLineNumber: s.startLine,
    startColumn: s.startColumn,
    endLineNumber: s.endLine,
    endColumn: s.endColumn,
  };
}

// §7.3: 0 and 1 are spelled out ("no references"/"1 reference") rather than "0 references"/
// "1 references" — the plural noun reads wrong at either edge.
function countLabel(n: number, noun: string): string {
  if (n === 0) return `no ${noun}s`;
  if (n === 1) return `1 ${noun}`;
  return `${n} ${noun}s`;
}

// §7.3: the unattributed/truncated clauses are omitted when zero/false, not printed as "0
// unattributed" — a clause with nothing to say is noise, the same discipline StatusBar.vue's own
// items already follow (absent, not a zero reading).
function referenceSummary(res: RefResult): NavStatusState {
  const parts = [countLabel(res.total, 'reference')];
  if (res.unattributed > 0) parts.push(`${res.unattributed} unattributed`);
  if (res.truncated) parts.push('truncated');

  const repoWide = res.sites.filter((s) => s.confidence === 'repoWide').length;
  const exactOrScoped = res.sites.length - repoWide;
  const tooltip = `${exactOrScoped} exact/scoped · ${repoWide} repo-wide`;

  return { kind: 'references', summary: parts.join(' · '), tooltip };
}

// §7.3: the method-set caveat is added only when every target came from Go's own structural
// matching (methodsets.go) — a mix with containment-recovered targets (a cross-language search
// this phase never produces, but the check costs nothing) would make the caveat read like it
// covers all of them.
function implementationSummary(res: NavResult): NavStatusState {
  const parts = [countLabel(res.targets.length, 'implementation')];
  if (
    res.targets.length > 0 &&
    res.targets.every((t) => t.rule.startsWith('implementationsOf.goMethodSet'))
  ) {
    parts.push('method set, signatures not compared');
  }
  return { kind: 'implementations', summary: parts.join(' · ') };
}

/** Registers the definition/hover/reference/implementation providers and the cross-file editor
 *  opener exactly once — called from RepoFileView.vue's and RepoDiffView.vue's own mount, right
 *  after loadMonaco(). */
export function ensureNavigationRegistered(mod: MonacoModule): void {
  if (registered) return;
  registered = true;

  mod.languages.registerDefinitionProvider(SELECTOR, {
    async provideDefinition(model, position) {
      const loc = repoLocationOf(model);
      if (!loc) return null;
      const res = await resolve(model, position);
      if (res?.status !== 'ready') return null;
      return res.targets.map((t) => ({
        uri: repoFileUriObject(mod, loc.repoId, t.path),
        range: {
          startLineNumber: t.startLine,
          startColumn: t.startColumn,
          endLineNumber: t.endLine,
          endColumn: t.endColumn,
        },
      }));
    },
  });

  mod.languages.registerHoverProvider(SELECTOR, {
    async provideHover(model, position) {
      const res = await resolve(model, position);
      if (!res) return null;
      if (res.status === 'indexing') {
        return {
          contents: [{ value: 'Code index is still building…' }],
        };
      }
      if (res.status !== 'ready' || res.targets.length === 0) return null;
      const word = model.getWordAtPosition(position);
      return {
        contents: [{ value: renderHoverMarkdown(res), isTrusted: false }],
        range: word
          ? {
              startLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: word.endColumn,
            }
          : undefined,
      };
    },
  });

  mod.languages.registerReferenceProvider(SELECTOR, {
    async provideReferences(model, position, context) {
      const loc = repoLocationOf(model);
      if (!loc) return null; // D7: the diff's own HEAD side, deliberately.
      const res = await control.codeWorkspaceReferences(
        loc.repoId,
        loc.path,
        position.lineNumber,
        position.column,
        context.includeDeclaration,
      );
      if (res.status !== 'ready') {
        publishNavStatus(null);
        return null;
      }
      publishNavStatus(referenceSummary(res));
      return res.sites.map((s) => ({
        uri: repoFileUriObject(mod, loc.repoId, s.path),
        range: rangeOf(s),
      }));
    },
  });

  mod.languages.registerImplementationProvider(SELECTOR, {
    async provideImplementation(model, position) {
      const loc = repoLocationOf(model);
      if (!loc) return null;
      const res = await control.codeWorkspaceImplementations(
        loc.repoId,
        loc.path,
        position.lineNumber,
        position.column,
      );
      if (res.status !== 'ready') {
        publishNavStatus(null);
        return null;
      }
      publishNavStatus(implementationSummary(res));
      return res.targets.map((t) => ({
        uri: repoFileUriObject(mod, loc.repoId, t.path),
        range: rangeOf(t),
      }));
    },
  });

  // The cross-file jump: SPEC's "a cross-file jump opens its target as a preview tab in C5's
  // workspace", satisfied by C5's own openRepoFileTab — no second tab-opening mechanism. A
  // same-file jump never reaches here; Monaco moves the cursor in the editor it is already in.
  mod.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'kira-repo') return false;
      const repoId = resource.authority;
      const path = resource.path.slice(1); // strip the leading '/' repoFileUriObject adds.
      const line = selectionOrPosition
        ? 'lineNumber' in selectionOrPosition
          ? selectionOrPosition.lineNumber
          : selectionOrPosition.startLineNumber
        : undefined;
      openRepoFileTab(repoId, path, { preview: true, reveal: line ? { line } : undefined });
      return true;
    },
  });
}
