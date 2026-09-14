import type { Locator } from '@playwright/test';

// P60a §9.1/OQ-3: Monaco virtualises lines — `.view-lines` only ever contains the currently
// rendered subset of a large document, unlike CodeMirror's `.cm-content` (whose `innerText` was
// the whole document) before it. `MonacoHost.vue` exposes its model's full text through a
// `__KIRA_DEBUG_HOOKS__`-gated `data-kira-editor-text` attribute on its own root element — the
// same convention `vite.config.ts`'s `__KIRA_DEBUG_HOOKS__` define and `main.ts`'s `window.__kira*`
// hooks already use, rather than a `page.evaluate` over a `window.monaco` global that isn't
// otherwise exposed. This is the one place every UI spec reads a Monaco host's full document from.

/** `container` is any Locator wrapping exactly one `MonacoHost` mount (a pane, a dialog body, a
 *  row) — finds that host's own root and reads its full text. Empty string if the attribute is
 *  absent (host still pending its first paint, or not a MonacoHost at all). */
export async function editorText(container: Locator): Promise<string> {
  const host = container.locator('[data-testid="monaco-host"]');
  return (await host.getAttribute('data-kira-editor-text')) ?? '';
}

/** `ResponseDiffDialog.vue`'s own diff editor — its two sides are plain Monaco sub-editors, not a
 *  `MonacoHost` mount, so they carry no `data-kira-editor-text` of their own; the dialog sets a
 *  pair of `data-kira-diff-{original,modified}-text` attributes directly on the diff host once its
 *  (static, read-only, never re-set) models are created. `container` is the diff host element
 *  itself (`[data-testid="http-diff-merge"]`). */
export async function diffEditorText(
  container: Locator,
): Promise<{ original: string; modified: string }> {
  const [original, modified] = await Promise.all([
    container.getAttribute('data-kira-diff-original-text'),
    container.getAttribute('data-kira-diff-modified-text'),
  ]);
  return { original: original ?? '', modified: modified ?? '' };
}
