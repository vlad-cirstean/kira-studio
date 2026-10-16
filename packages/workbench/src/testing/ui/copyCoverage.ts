import { expect, type Locator, type Page } from '@playwright/test';

// Proves chrome text comes from the catalog. The pseudo-locale wraps every catalog message as
// `⟦…⟧`, so any visible letter outside a marker is a literal that bypassed `t()`. Test builds only:
// `window.__kiraSetLocale` is installed under __KIRA_DEBUG_HOOKS__ (packages/theme/src/i18n).

/** Subtrees whose text is data, not chrome: code, grid cells, editors (Monaco, ProseMirror), terminals, variable chips. */
// `[id^="vue-flow__"]` is the flow engine's own keyboard hint text (not localisable, P265 open item).
const SKIP_SUBTREE =
  'pre, code, .font-data, [data-var], .monaco-editor, .ProseMirror, .xterm, .slick-cell, [data-testid$="-shortcut"], [id^="vue-flow__"]';
const SKIP_TAGS = 'script, style, noscript, template';
const TEXT_ATTRIBUTES = ['aria-label', 'title', 'placeholder'] as const;

export interface CatalogTextOptions {
  /** Values (fixture names, user data) that may show without a marker; tested against each value. */
  allow?: RegExp[];
}

interface Offender {
  where: string;
  value: string;
}

/** Switches the page to the pseudo-locale. Throws when the build has no test hook. */
export async function setPseudoLocale(page: Page): Promise<void> {
  const installed = await page.evaluate(() => {
    const hook = (window as unknown as { __kiraSetLocale?: (locale: 'en' | 'pseudo') => void })
      .__kiraSetLocale;
    if (!hook) return false;
    hook('pseudo');
    return true;
  });
  if (!installed) {
    throw new Error('copyCoverage: window.__kiraSetLocale is missing; use a build:test bundle');
  }
}

/**
 * Walks the text nodes and aria-label, title and placeholder attributes under `locator` and fails on
 * any value with a letter outside `⟦…⟧`. Reka renders tooltip text twice; both copies carry markers.
 */
export async function expectCatalogText(
  locator: Locator,
  options: CatalogTextOptions = {},
): Promise<void> {
  const allow = (options.allow ?? []).map((re) => ({ source: re.source, flags: re.flags }));
  const offenders = await locator.evaluateAll(
    (roots, args): Offender[] => {
      const allowed = args.allow.map((a) => new RegExp(a.source, a.flags));
      const found: Offender[] = [];
      // Marker depth runs across text nodes in document order: a message with element slots or text
      // params renders as sibling nodes (`⟦`, param, ` at `, slot, `⟧`), and a param can itself be a
      // marked message, so one node may open or close several levels.
      let depth = 0;
      const hasBareLetter = (value: string): boolean => {
        let bare = false;
        for (const ch of value) {
          if (ch === '⟦') depth++;
          else if (ch === '⟧') depth = Math.max(0, depth - 1);
          else if (depth === 0 && /\p{L}/u.test(ch)) bare = true;
        }
        return bare && !allowed.some((re) => re.test(value));
      };
      const describe = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        return id ? `${el.tagName.toLowerCase()}[data-testid=${id}]` : el.tagName.toLowerCase();
      };
      const scanAttributes = (el: Element): void => {
        // reka's Switch copies its `label[for]` text into aria-label once at mount, so it keeps the
        // old locale after a switch; the visible label is checked as text.
        const derivedSwitch =
          el.getAttribute('role') === 'switch' &&
          !!el.id &&
          !!el.ownerDocument.querySelector(`label[for="${el.id}"]`);
        for (const name of args.attributes) {
          if (name === 'aria-label' && derivedSwitch) continue;
          const value = el.getAttribute(name)?.trim();
          if (!value) continue;
          const saved = depth;
          depth = 0;
          if (hasBareLetter(value)) found.push({ where: `${name} of ${describe(el)}`, value });
          depth = saved;
        }
      };
      const visit = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
          const value = (node.textContent ?? '').trim();
          const parent = node.parentElement;
          if (value && parent && hasBareLetter(value)) {
            found.push({ where: `text in ${describe(parent)}`, value });
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (el.matches(args.skipTags) || el.matches(args.skipSubtree)) return;
        scanAttributes(el);
        // A textarea's child text is its value, not chrome.
        if (el.tagName === 'TEXTAREA') return;
        for (const child of Array.from(el.childNodes)) visit(child);
      };
      for (const root of roots) {
        depth = 0;
        visit(root);
      }
      return found;
    },
    {
      allow,
      skipSubtree: SKIP_SUBTREE,
      skipTags: SKIP_TAGS,
      attributes: [...TEXT_ATTRIBUTES],
    },
  );
  expect(
    offenders.map((o) => `${o.where}: ${JSON.stringify(o.value)}`),
    'text outside the catalog (pseudo-locale marker missing)',
  ).toEqual([]);
}
