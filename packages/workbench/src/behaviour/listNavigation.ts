import { useEventListener } from '@vueuse/core';
import { computed, nextTick, type Ref, watch } from 'vue';
import { shortcutFor } from '../shortcuts/keys';
import { TIMING } from './timing';

/** What the key rules need to know about one row. */
export interface NavRow {
  key: string;
  disabled?: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
}

export type NavAction =
  | { kind: 'move'; index: number }
  | { kind: 'expand'; index: number }
  | { kind: 'collapse'; index: number }
  | { kind: 'none' };

const NONE: NavAction = { kind: 'none' };

function firstEnabled(rows: readonly NavRow[], from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < rows.length; i += step) {
    if (!rows[i].disabled) return i;
  }
  return -1;
}

function treeRight(rows: readonly NavRow[], active: number): NavAction {
  const row = rows[active];
  if (row.hasChildren && !row.expanded) return { kind: 'expand', index: active };
  const next = rows[active + 1];
  if (row.expanded && next && !next.disabled && (next.depth ?? 0) > (row.depth ?? 0)) {
    return { kind: 'move', index: active + 1 };
  }
  return NONE;
}

function treeLeft(rows: readonly NavRow[], active: number): NavAction {
  const row = rows[active];
  if (row.expanded && row.hasChildren) return { kind: 'collapse', index: active };
  for (let i = active - 1; i >= 0; i--) {
    if ((rows[i].depth ?? 0) < (row.depth ?? 0)) {
      return rows[i].disabled ? NONE : { kind: 'move', index: i };
    }
  }
  return NONE;
}

/** The one key rule set for every list and tree: Up/Down skip disabled rows without wrapping,
 *  Home/End jump to the ends, tree Right expands or enters the first child, tree Left collapses or
 *  goes to the parent (WAI-ARIA tree pattern). `active` is -1 when no row holds the roving stop. */
export function navigate(
  rows: readonly NavRow[],
  active: number,
  key: string,
  tree: boolean,
): NavAction {
  const move = (index: number): NavAction =>
    index >= 0 && index !== active ? { kind: 'move', index } : NONE;
  if (key === 'ArrowDown') return move(firstEnabled(rows, active < 0 ? 0 : active + 1, 1));
  if (key === 'ArrowUp') {
    return move(active < 0 ? firstEnabled(rows, 0, 1) : firstEnabled(rows, active - 1, -1));
  }
  if (key === 'Home') return move(firstEnabled(rows, 0, 1));
  if (key === 'End') return move(firstEnabled(rows, rows.length - 1, -1));
  if (!tree || active < 0) return NONE;
  if (key === 'ArrowRight') return treeRight(rows, active);
  if (key === 'ArrowLeft') return treeLeft(rows, active);
  return NONE;
}

/** First-letter type-ahead: a single character (or the same character repeated) cycles through
 *  rows starting with it; a longer buffer matches its prefix from the active row. The buffer resets
 *  after `timeout` ms without a key. */
export function createTypeahead(now: () => number = Date.now, timeout: number = TIMING.typeahead) {
  let buffer = '';
  let last = Number.NEGATIVE_INFINITY;
  return {
    /** Index of the row to activate for `char`, or -1. */
    press(char: string, rows: readonly (string | null)[], active: number): number {
      const t = now();
      buffer = t - last > timeout ? char : buffer + char;
      last = t;
      const needle = buffer.toLowerCase();
      const cycling = [...needle].every((c) => c === needle[0]);
      const search = cycling ? needle[0] : needle;
      const start = cycling ? active + 1 : Math.max(active, 0);
      for (let n = 0; n < rows.length; n++) {
        const i = (start + n) % rows.length;
        const text = rows[i];
        if (text?.toLowerCase().startsWith(search)) return i;
      }
      return -1;
    },
    reset(): void {
      buffer = '';
      last = Number.NEGATIVE_INFINITY;
    },
  };
}

/** A focus request that may land before its row exists (a virtual list scrolls first, renders
 *  next). `request` tries at once; `flush` retries after each render until the row is there. A
 *  newer request replaces an unmet older one. */
export function createPendingFocus(attempt: (key: string) => boolean) {
  let pending: string | null = null;
  return {
    request(key: string): void {
      pending = key;
      this.flush();
    },
    flush(): void {
      if (pending !== null && attempt(pending)) pending = null;
    },
    get pending(): string | null {
      return pending;
    },
  };
}

export interface ListNavigationOptions<T> {
  /** Element that receives the key events. */
  container: Ref<HTMLElement | null | undefined>;
  items: () => readonly T[];
  key: (item: T) => string;
  isDisabled?: (item: T) => boolean;
  /** The roving stop. Selection-driven lists pass a ref bound to their selection. */
  activeKey: Ref<string | null>;
  /** Space, and Up/Down/Home/End too when `selectOnMove`. */
  onSelect?: (item: T, info: { reason: 'key' | 'move' }) => void;
  selectOnMove?: boolean;
  /** Enter: the primary action, same as double-click. */
  onOpen?: (item: T) => void;
  /** ContextMenu key and Shift+F10, with the row's rect. */
  onMenu?: (item: T, rect: DOMRect) => void | Promise<void>;
  /** Up from the first row (a filter field above the list). */
  onExitTop?: () => void;
  tree?: {
    depth: (item: T) => number;
    isExpanded: (item: T) => boolean;
    hasChildren: (item: T) => boolean;
    expand: (item: T) => void;
    collapse: (item: T) => void;
  };
  /** Row text for first-letter type-ahead. Leave unset on a list whose panel has a search field. */
  typeahead?: (item: T) => string;
  /** Bring a row's index into view before it is focused (virtual lists). */
  scrollToIndex?: (index: number, key: string) => void | Promise<void>;
  /** Re-read after each render; a change retries a focus request still waiting for its row. */
  rendered?: () => unknown;
  /** CSS selector of one row. Default: `[data-nav-key="<key>"]` (see `rowProps`). */
  rowSelector?: (key: string) => string;
}

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const TEXT_FIELD = 'input, textarea, select, [contenteditable="true"]';

export function useListNavigation<T>(opts: ListNavigationOptions<T>) {
  const selectorFor = opts.rowSelector ?? ((key: string) => `[data-nav-key="${CSS.escape(key)}"]`);
  const typeahead = createTypeahead();

  const rows = (): NavRow[] =>
    opts.items().map((item) => ({
      key: opts.key(item),
      disabled: opts.isDisabled?.(item) ?? false,
      depth: opts.tree?.depth(item),
      hasChildren: opts.tree?.hasChildren(item),
      expanded: opts.tree?.isExpanded(item),
    }));

  const tabStopKey = computed(() => {
    const list = opts.items();
    const current = opts.activeKey.value;
    if (current !== null && list.some((item) => opts.key(item) === current)) return current;
    const first = list.find((item) => !opts.isDisabled?.(item));
    return first === undefined ? null : opts.key(first);
  });

  function tabindexFor(key: string): 0 | -1 {
    return tabStopKey.value === key ? 0 : -1;
  }

  function rowElement(key: string): HTMLElement | null {
    return opts.container.value?.querySelector<HTMLElement>(selectorFor(key)) ?? null;
  }

  const pendingFocus = createPendingFocus((key) => {
    const el = rowElement(key);
    if (!el) return false;
    el.focus();
    return true;
  });

  if (opts.rendered) watch(opts.rendered, () => pendingFocus.flush(), { flush: 'post' });

  /** Make `key` the roving stop, scroll it in, and focus its row once it renders. */
  async function focusKey(key: string): Promise<void> {
    const index = opts.items().findIndex((item) => opts.key(item) === key);
    if (index < 0) return;
    opts.activeKey.value = key;
    await opts.scrollToIndex?.(index, key);
    await nextTick();
    pendingFocus.request(key);
  }

  function activate(index: number, reason: 'move'): void {
    const item = opts.items()[index];
    if (opts.selectOnMove) opts.onSelect?.(item, { reason });
    void focusKey(opts.key(item));
  }

  interface KeyContext {
    list: readonly T[];
    view: NavRow[];
    activeIndex: number;
    item: T | undefined;
    target: HTMLElement;
  }

  function onMenuKey(e: KeyboardEvent, cx: KeyContext): boolean {
    const menuKey = shortcutFor(e, ['menu.open']) !== null;
    if (!menuKey || cx.item === undefined || !opts.onMenu) return false;
    const row = rowElement(opts.key(cx.item));
    if (row?.contains(cx.target)) {
      e.preventDefault();
      opts.onMenu(cx.item, row.getBoundingClientRect());
    }
    return true;
  }

  function onActivationKey(e: KeyboardEvent, cx: KeyContext): boolean {
    if (e.key !== 'Enter' && e.key !== ' ') return false;
    if (cx.item === undefined || e.shiftKey) return true;
    // Only the row itself: a button nested in it keeps its own Enter and Space.
    if (cx.target !== rowElement(opts.key(cx.item))) return true;
    if (e.key === 'Enter' && opts.onOpen) {
      e.preventDefault();
      opts.onOpen(cx.item);
    } else if (opts.onSelect) {
      e.preventDefault();
      opts.onSelect(cx.item, { reason: 'key' });
    }
    return true;
  }

  function onMoveKey(e: KeyboardEvent, cx: KeyContext): boolean {
    if (!MOVE_KEYS.has(e.key)) return false;
    e.preventDefault();
    const action = navigate(cx.view, cx.activeIndex, e.key, opts.tree !== undefined);
    if (action.kind === 'none') {
      if (e.key === 'ArrowUp') opts.onExitTop?.();
    } else if (action.kind === 'move') activate(action.index, 'move');
    else if (action.kind === 'expand') opts.tree?.expand(cx.list[action.index]);
    else opts.tree?.collapse(cx.list[action.index]);
    return true;
  }

  function onTypeaheadKey(e: KeyboardEvent, cx: KeyContext): void {
    if (!opts.typeahead || e.key.length !== 1 || e.key === ' ') return;
    const texts = cx.list.map((it) =>
      opts.isDisabled?.(it) ? null : (opts.typeahead?.(it) ?? null),
    );
    const index = typeahead.press(e.key, texts, cx.activeIndex);
    if (index >= 0) {
      e.preventDefault();
      activate(index, 'move');
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest(TEXT_FIELD)) return;
    const list = opts.items();
    const view = rows();
    // Focus wins over the roving stop: a selection reset behind a focused row must not strand Home/Up.
    const focusedKey = target.closest<HTMLElement>('[data-nav-key]')?.dataset.navKey;
    const focusedIndex =
      focusedKey === undefined ? -1 : view.findIndex((r) => r.key === focusedKey);
    const activeIndex =
      focusedIndex >= 0 ? focusedIndex : view.findIndex((r) => r.key === tabStopKey.value);
    const cx: KeyContext = {
      list,
      view,
      activeIndex,
      item: activeIndex < 0 ? undefined : list[activeIndex],
      target,
    };
    if (onMenuKey(e, cx)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (onActivationKey(e, cx)) return;
    if (e.shiftKey) return;
    if (!onMoveKey(e, cx)) onTypeaheadKey(e, cx);
  }

  useEventListener(opts.container, 'keydown', onKeydown);

  /** Bind on a row: `v-bind="nav.rowProps(key)"` (roving tabindex, key attribute, focus tracking). */
  function rowProps(key: string) {
    return {
      'data-nav-key': key,
      tabindex: tabindexFor(key),
      onFocus: () => {
        opts.activeKey.value = key;
      },
    };
  }

  return { activeKey: opts.activeKey, tabindexFor, focusKey, rowProps };
}
