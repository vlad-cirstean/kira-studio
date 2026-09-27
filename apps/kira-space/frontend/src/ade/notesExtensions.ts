import type { AnyExtension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// P129 Part 6 §0.16: the shared extension set for `AdeNotesEditor.vue` and the headless Markdown
// round-trip spec (`ade-notes-markdown.spec.ts`) — one factory so the two never drift. `underline:
// false` because Markdown has no underline syntax (StarterKit's own default would silently drop it
// on save); `link.openOnClick: false` since every open routes through §0.9's own OS-open path, not
// TipTap's own click handler.
export function notesExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: 'Write notes…' }),
    Markdown,
  ];
}
