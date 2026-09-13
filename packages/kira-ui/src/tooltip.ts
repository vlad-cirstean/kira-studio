import type { ObjectDirective } from 'vue';
import { reactive } from 'vue';

/**
 * G20 D2: `packages/kira-ui`'s own tooltip controller — a fresh, host-agnostic reimplementation
 * of `apps/kira-studio/frontend/src/workbench/state/tooltip.ts`'s singleton (one controller, one
 * document-level pointermove listener set, one floating element per document — see `KuiTooltip
 * .vue`), replacing `packages/git-ui`'s 62 native `title`/`:title` tooltips.
 *
 * Deliberately smaller than the app-side original: every one of `packages/git-ui`'s candidate
 * sites is a plain string (`title="Refresh"`, `:title="branchName"`) — no caller needs the
 * app-side `TooltipContent` (`title`/`meta`/`metaColor`/`body`) shape, so `vKuiTooltip` accepts
 * `string | null | undefined` only.
 *
 * One instance per webview document, not a cross-document singleton — `packages/git-ui`'s
 * `App.vue` mounts one `<KuiTooltip />` for the graph panel; `ReviewView.vue` mounts a second,
 * independent one for the review sidebar (G19 F3: two webview documents cannot share one
 * singleton — a fact about `iframe` document isolation).
 */

/** The app's one hover-pause constant, kept at the same value as the port's own source
 *  (`TOOLTIP_DELAY_MS`/`TOOLTIP_REARM_MS` — 400ms/300ms are a considered hover-ergonomics choice,
 *  not app-specific). */
export const TOOLTIP_DELAY_MS = 400;
/** Moving between two hinted controls within this window re-opens with no delay, so scanning a
 *  toolbar reads as one gesture instead of several separate 400ms waits. */
export const TOOLTIP_REARM_MS = 300;

/** The attribute the directive writes and the controller reads — also the Playwright handle that
 *  replaces `title` (one source of truth for hit-testing and for the displayed string). */
const TIP_ATTR = 'data-kui-tip';

/** Distinguishes an `aria-label` this directive set (safe to keep in sync with a changing hint)
 *  from one the author wrote (never touched). */
const OWNS_LABEL_ATTR = 'data-kui-tip-auto-label';

const TOOLTIP_ID = 'kui-tooltip';

export const tooltipState = reactive({
  text: '',
  open: false,
  /** Set while open, for `KuiTooltip.vue`'s `id` and the trigger's `aria-describedby`. */
  id: null as string | null,
});

// Plain (non-reactive) controller state — a live DOM element reference has no business being
// proxied.
let openHostEl: HTMLElement | null = null;
let pendingHostEl: HTMLElement | null = null;
let cachedHostRect: DOMRect | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let lastCloseAt = 0;
let lastPointerTarget: EventTarget | null = null;

/** `KuiTooltip.vue`'s own placement (`floatingPosition.ts`'s `computeFloatPosition`) reads the
 *  live trigger element at render time, not a rect computed ahead of it. */
export function getAnchorElement(): HTMLElement | null {
  return openHostEl;
}

function clearOpenTimer(): void {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  pendingHostEl = null;
}

function hideTooltip(): void {
  if (openHostEl) openHostEl.removeAttribute('aria-describedby');
  openHostEl = null;
  cachedHostRect = null;
  tooltipState.open = false;
  tooltipState.text = '';
  tooltipState.id = null;
  lastCloseAt = performance.now();
}

function openFor(el: HTMLElement): void {
  const tip = el.getAttribute(TIP_ATTR);
  if (!tip) return;
  openHostEl = el;
  cachedHostRect = el.getBoundingClientRect();
  tooltipState.text = tip;
  tooltipState.id = TOOLTIP_ID;
  tooltipState.open = true;
  el.setAttribute('aria-describedby', TOOLTIP_ID);
}

function withinRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Extracted as a pure function purely so it gets a real unit test (G20 §4.1) — the app-side
 *  original this is ported from has never had one either. */
export function isWithinRearmWindow(
  now: number,
  lastCloseAtTime: number,
  rearmMs: number,
): boolean {
  return now - lastCloseAtTime < rearmMs;
}

function enterHost(host: HTMLElement | null, immediate: boolean): void {
  const activeHost = openHostEl ?? pendingHostEl;
  if (host === activeHost) return;

  clearOpenTimer();
  const withinRearmWindow =
    tooltipState.open || isWithinRearmWindow(performance.now(), lastCloseAt, TOOLTIP_REARM_MS);
  if (tooltipState.open) hideTooltip();

  if (!host) return;

  if (immediate || withinRearmWindow) {
    openFor(host);
  } else {
    pendingHostEl = host;
    openTimer = setTimeout(() => {
      pendingHostEl = null;
      openFor(host);
    }, TOOLTIP_DELAY_MS);
  }
}

// Document-level, rAF-coalesced pointermove, resolving the hovered host via `elementFromPoint` —
// deliberately not `mouseenter`/`pointerover` on the trigger, so a disabled control (which
// receives no pointer events in Blink) still shows its hint the same way the native `title`
// tooltip did.
function processPointer(x: number, y: number, target: EventTarget | null): void {
  if (openHostEl && cachedHostRect && withinRect(x, y, cachedHostRect)) {
    lastPointerTarget = target;
    return;
  }
  if (target === lastPointerTarget) return;
  lastPointerTarget = target;

  const host = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  enterHost(host, false);
}

function onPointerDown(): void {
  clearOpenTimer();
  if (tooltipState.open) hideTooltip();
}

function onKeyDown(): void {
  clearOpenTimer();
  if (tooltipState.open) hideTooltip();
}

function onFocusIn(e: FocusEvent): void {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  if (el) enterHost(el, true);
}

function onFocusOut(e: FocusEvent): void {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  if (el && el === openHostEl) hideTooltip();
}

function onScroll(): void {
  clearOpenTimer();
  if (tooltipState.open) hideTooltip();
}

function onWindowBlur(): void {
  clearOpenTimer();
  if (tooltipState.open) hideTooltip();
}

/** Installs the single document-level listener set. Called once from each host's `App.vue`-shaped
 *  root, alongside its `<KuiTooltip />` mount; returns its own teardown so a test (or a future
 *  remount) leaves nothing behind. */
export function initTooltips(): () => void {
  let rafId: number | null = null;
  let pendingX = 0;
  let pendingY = 0;
  let pendingTarget: EventTarget | null = null;
  let hasPending = false;

  function flush(): void {
    rafId = null;
    if (!hasPending) return;
    hasPending = false;
    processPointer(pendingX, pendingY, pendingTarget);
  }

  function onPointerMove(e: PointerEvent): void {
    pendingX = e.clientX;
    pendingY = e.clientY;
    pendingTarget = e.target;
    hasPending = true;
    if (rafId === null) rafId = requestAnimationFrame(flush);
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('blur', onWindowBlur);

  return () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', onWindowBlur);
    if (rafId !== null) cancelAnimationFrame(rafId);
    clearOpenTimer();
    if (tooltipState.open) hideTooltip();
  };
}

function hasForeignAccessibleName(el: HTMLElement): boolean {
  if (el.hasAttribute('aria-labelledby')) return true;
  if (!el.hasAttribute(OWNS_LABEL_ATTR) && el.hasAttribute('aria-label')) return true;
  return (el.textContent ?? '').trim().length > 0;
}

function updateTip(el: HTMLElement, value: string | null | undefined): void {
  if (!value) {
    el.removeAttribute(TIP_ATTR);
    if (el.hasAttribute(OWNS_LABEL_ATTR)) {
      el.removeAttribute('aria-label');
      el.removeAttribute(OWNS_LABEL_ATTR);
    }
    if (openHostEl === el) hideTooltip();
    return;
  }
  el.setAttribute(TIP_ATTR, value);
  if (!hasForeignAccessibleName(el)) {
    el.setAttribute('aria-label', value);
    el.setAttribute(OWNS_LABEL_ATTR, '');
  }
  if (openHostEl === el) tooltipState.text = value;
}

/** Registered once per host as `v-kui-tooltip` (`main.ts`). `title="X"` becomes
 *  `v-kui-tooltip="'X'"`, `:title="expr"` becomes `v-kui-tooltip="expr"` — no component gains a
 *  prop, no template gains a wrapper element. */
export const vKuiTooltip: ObjectDirective<HTMLElement, string | null | undefined> = {
  mounted(el, binding) {
    updateTip(el, binding.value);
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) updateTip(el, binding.value);
  },
  unmounted(el) {
    el.removeAttribute(TIP_ATTR);
    if (el.hasAttribute(OWNS_LABEL_ATTR)) {
      el.removeAttribute('aria-label');
      el.removeAttribute(OWNS_LABEL_ATTR);
    }
    if (openHostEl === el) hideTooltip();
    if (pendingHostEl === el) clearOpenTimer();
  },
};
