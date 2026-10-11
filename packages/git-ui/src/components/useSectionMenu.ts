import {
  type ContextMenuOptions,
  type MenuItem,
  useContextMenuStore,
} from '@workbench/state/contextMenu';
import { type MenuSection, sectionsToMenuItems } from '../lib/menuModel.ts';

interface SectionMenuOptions extends ContextMenuOptions {
  /** A heading row above the sections (names what the menu acts on). */
  title?: string;
}

/** Opens git-ui's `MenuSection[]` menus through the shared context menu store: at the pointer for
 *  a right-click, under the element for a "More actions" button. */
export function useSectionMenu() {
  const store = useContextMenuStore();

  function itemsFor(
    sections: readonly MenuSection[],
    onSelect: (id: string) => void | Promise<void>,
    title?: string,
  ): MenuItem[] {
    const items = sectionsToMenuItems(sections, onSelect);
    return title === undefined ? items : [{ type: 'label', label: title }, ...items];
  }

  function openAtPoint(
    x: number,
    y: number,
    sections: readonly MenuSection[],
    onSelect: (id: string) => void | Promise<void>,
    options: SectionMenuOptions = {},
  ): void {
    store.openContextMenuAt(x, y, itemsFor(sections, onSelect, options.title), options);
  }

  function openAt(
    event: MouseEvent,
    sections: readonly MenuSection[],
    onSelect: (id: string) => void | Promise<void>,
    options: SectionMenuOptions = {},
  ): void {
    event.preventDefault();
    openAtPoint(event.clientX, event.clientY, sections, onSelect, options);
  }

  function openFromButton(
    event: MouseEvent,
    sections: readonly MenuSection[],
    onSelect: (id: string) => void | Promise<void>,
    options: SectionMenuOptions = {},
  ): void {
    store.openContextMenuFor(
      event.currentTarget as Element,
      itemsFor(sections, onSelect, options.title),
      options,
    );
  }

  return { openAtPoint, openAt, openFromButton, close: store.closeContextMenu };
}
