import type { ObjectDirective } from 'vue';
import { reactive } from 'vue';

// P22: the app's own tooltip mechanism, replacing the native `title` attribute everywhere in
// apps/kira-studio/frontend/src. One controller, one listener set, one floating element (AppTooltip.vue) — not 123
// components each running their own mouseenter timer. Mirrors ContextMenu.vue's singleton shape
// (F7) and ErrorPopover.vue's placement maths (F8).

/** F4/D6: the app's one hover-pause constant, shared with the editor's lint tooltip
 *  (CodeMirrorHost.vue's `delay: 400`). */
export const TOOLTIP_DELAY_MS = 400;
/** D6: moving between two hinted controls within this window re-opens with no delay, so scanning
 *  a toolbar reads as one gesture instead of five separate 400 ms waits. */
export const TOOLTIP_REARM_MS = 300;

/** The attribute the directive writes and the controller reads — also the Playwright handle that
 *  replaces `title` (D8: one source of truth for hit-testing and for the displayed string). */
const TIP_ATTR = 'data-kira-tip';

/** P42 D19: the structured half of a tooltip — carried in a second attribute so `data-kira-tip`
 *  itself stays the exact newline-joined plain text it always was (the a11y mirror, and every
 *  existing Playwright assertion). A plain string tooltip never sets this at all. */
export interface TooltipContent {
  title: string;
  meta?: string;
  /** The data-type badge's own colour (columnTypeColor, theme/icons.ts) — the only caller of
   *  `meta` today is a column-type hint, and the badge is what carries the colour visibly rather
   *  than the plain a11y text these get joined into (toPlainText below), so this never affects it. */
  metaColor?: string;
  body?: string;
}

const PARTS_ATTR = 'data-kira-tip-parts';

function isTooltipContent(value: string | TooltipContent): value is TooltipContent {
  return typeof value === 'object';
}

function toPlainText(value: TooltipContent): string {
  return [value.title, value.meta, value.body].filter((v): v is string => !!v).join('\n');
}

/** D7 rule 1's marker: distinguishes an `aria-label` this directive set (safe to keep in sync with
 *  a changing hint) from one the author wrote (never touched — F6's seven carve-out sites). */
const OWNS_LABEL_ATTR = 'data-kira-tip-auto-label';

const TOOLTIP_ID = 'app-tooltip';

export const tooltipState = reactive({
  text: '',
  /** P42 D19: set alongside `text` whenever the open tooltip's own value is a `TooltipContent` —
   *  AppTooltip.vue renders from this when present, and falls back to the plain `text` node
   *  otherwise. `text` itself is never just this cast back to a string; it is always the
   *  independently-tracked plain-text join, so the two can never drift. */
  parts: null as TooltipContent | null,
  open: false,
  /** Set while open, for AppTooltip.vue's `id` and the trigger's `aria-describedby` (D7). */
  id: null as string | null,
});

// Plain (non-reactive) controller state — a live DOM element reference has no business being
// proxied (§0's no-reactivity rule, applied here the same way it is to CodeMirror's EditorView).
let openHostEl: HTMLElement | null = null;
let pendingHostEl: HTMLElement | null = null;
let cachedHostRect: DOMRect | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let lastCloseAt = 0;
let lastPointerTarget: EventTarget | null = null;

/** AppTooltip.vue's own placement (P23: @floating-ui/dom's computePosition, mirroring
 *  ErrorPopover.vue) reads the live trigger element at render time, not a rect computed ahead of
 *  it — the tooltip's own size depends on text that just changed, so there is nothing useful the
 *  controller could precompute here. */
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
  tooltipState.parts = null;
  tooltipState.id = null;
  lastCloseAt = performance.now();
}

// P42 D19: JSON. Finding 8 (round 2) — this comment used to claim PARTS_ATTR was "only ever
// written/read by this module"; it's since also written directly by SlickGridHost.vue and
// ConsoleSlickGrid.vue's own tooltipAttrs() (P42 D19/D20, no dynamic import of this module — the
// value never leaves a data attribute either writer already controls). No security consequence
// (still this app's own generated JSON, never external input) — a parse failure still degrades to
// "no structure" rather than throwing, since a malformed value here would be a bug in one of those
// three writers, not untrusted input.
function readParts(el: HTMLElement): TooltipContent | null {
  const raw = el.getAttribute(PARTS_ATTR);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TooltipContent;
  } catch {
    return null;
  }
}

function openFor(el: HTMLElement): void {
  const tip = el.getAttribute(TIP_ATTR);
  if (!tip) return;
  openHostEl = el;
  cachedHostRect = el.getBoundingClientRect();
  tooltipState.text = tip;
  tooltipState.parts = readParts(el);
  tooltipState.id = TOOLTIP_ID;
  tooltipState.open = true;
  el.setAttribute('aria-describedby', TOOLTIP_ID);
}

function withinRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function enterHost(host: HTMLElement | null, immediate: boolean): void {
  const activeHost = openHostEl ?? pendingHostEl;
  if (host === activeHost) return;

  clearOpenTimer();
  const withinRearmWindow = tooltipState.open || performance.now() - lastCloseAt < TOOLTIP_REARM_MS;
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

// D3: a document-level, rAF-coalesced pointermove, resolving the hovered host via
// `elementFromPoint` — deliberately not `mouseenter`/`pointerover` on the trigger. Blink dispatches
// no pointer events on a disabled form control (F5), and a dozen of this app's hints exist only to
// explain a disabled state; hit testing is unaffected by `disabled`, so this reaches them the same
// way the native `title` tooltip did. Two guards keep the steady state (pointer resting on a
// button) free of any hit test at all.
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
  // Every key closes it, not just Escape — a keyboard user actively typing or navigating
  // elsewhere shouldn't have a stale hint sitting over unrelated content (D6).
  clearOpenTimer();
  if (tooltipState.open) hideTooltip();
}

function onFocusIn(e: FocusEvent): void {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  if (el) enterHost(el, true); // a focus move is a discrete action, not a pointer passing by
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

/** Installs the single document-level listener set (D3). Called once from App.vue's onMounted,
 *  alongside the existing `control.on*` subscriptions; returns its own teardown so a test (or a
 *  future remount) leaves nothing behind — `tests/e2e/leaks.spec.ts` exercises this. */
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

function updateTip(el: HTMLElement, value: string | TooltipContent | null | undefined): void {
  if (!value) {
    el.removeAttribute(TIP_ATTR);
    el.removeAttribute(PARTS_ATTR);
    if (el.hasAttribute(OWNS_LABEL_ATTR)) {
      el.removeAttribute('aria-label');
      el.removeAttribute(OWNS_LABEL_ATTR);
    }
    if (openHostEl === el) hideTooltip();
    return;
  }
  const structured = isTooltipContent(value);
  const plainText = structured ? toPlainText(value) : value;
  el.setAttribute(TIP_ATTR, plainText);
  if (structured) el.setAttribute(PARTS_ATTR, JSON.stringify(value));
  else el.removeAttribute(PARTS_ATTR);
  if (structured || !hasForeignAccessibleName(el)) {
    el.setAttribute('aria-label', plainText);
    el.setAttribute(OWNS_LABEL_ATTR, '');
  }
  if (openHostEl === el) {
    tooltipState.text = plainText;
    tooltipState.parts = structured ? value : null;
  }
}

/** Registered once in main.ts as `v-tooltip` (F9). `title="X"` becomes `v-tooltip="'X'"`,
 *  `:title="expr"` becomes `v-tooltip="expr"` — no component gains a prop, no template gains a
 *  wrapper element. Both button primitives are single-root, so Vue applies this to the real
 *  `<button>` exactly where `title=` landed before (F2). P42 D19: a `TooltipContent` object widens
 *  the value this directive accepts — the plain-string case (still the overwhelming majority of
 *  ~120 call sites) is unchanged in every observable way. */
export const vTooltip: ObjectDirective<HTMLElement, string | TooltipContent | null | undefined> = {
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
