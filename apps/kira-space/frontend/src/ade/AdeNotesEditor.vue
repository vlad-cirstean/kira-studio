<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { control } from '../bridge/control';
import { notesExtensions } from './notesExtensions';

// P129 Part 6 §0.16: the Notes editor (mockup 355-369) — TipTap v3 + `@tiptap/markdown` (headless,
// no DOM needed to parse/serialize — the deviation §0.16 names against `tiptap-markdown`). Loads and
// saves Markdown only; ProseMirror JSON never reaches the wire.
const props = defineProps<{
  notes: string;
  itemId: string;
}>();

const emit = defineEmits<{ save: [value: string] }>();

let lastEmitted = props.notes;

function flush(): void {
  const ed = editor.value;
  if (!ed) return;
  const md = ed.getMarkdown();
  if (md !== lastEmitted) {
    lastEmitted = md;
    emit('save', md);
  }
}

const debouncedFlush = useDebounceFn(flush, 600);

const editor = useEditor({
  content: props.notes,
  contentType: 'markdown',
  extensions: notesExtensions(),
  editorProps: {
    attributes: { class: 'ade-notes-prose', 'aria-label': 'Notes' },
    handleClick(_view, _pos, event) {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a');
      if (link && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void control.linkOpenExternal(link.href);
        return true;
      }
      return false;
    },
  },
  onUpdate: () => debouncedFlush(),
  onBlur: () => flush(),
});

// Refetch safety (§0.16): re-set content on an item switch (after flushing whatever was pending for
// the outgoing item), or when the incoming `notes` differs from what this editor last emitted and
// the editor isn't focused — never while the user is mid-edit.
watch(
  () => props.itemId,
  () => {
    flush();
    const ed = editor.value;
    if (!ed) return;
    lastEmitted = props.notes;
    ed.commands.setContent(props.notes, { contentType: 'markdown', emitUpdate: false });
  },
);

watch(
  () => props.notes,
  (next) => {
    const ed = editor.value;
    if (!ed || ed.isFocused || next === lastEmitted) return;
    lastEmitted = next;
    ed.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
  },
);

onBeforeUnmount(() => {
  flush();
  editor.value?.destroy();
});

// ---- Toolbar (mockup `noteToolbar`, order: Bold, Italic, Code, Heading, Bulleted, Numbered,
// Checklist, Link) — codicon where the theme has one, else the mockup's own glyph text. -----------
interface ToolbarButton {
  label: string;
  icon: string;
  glyph: string;
  active: boolean;
  run: () => void;
}

const toolbar = computed<ToolbarButton[]>(() => {
  const ed = editor.value;
  if (!ed) return [];
  const chain = () => ed.chain().focus();
  return [
    { label: 'Bold', icon: 'bold', glyph: 'B', active: ed.isActive('bold'), run: () => chain().toggleBold().run() },
    {
      label: 'Italic',
      icon: 'italic',
      glyph: 'I',
      active: ed.isActive('italic'),
      run: () => chain().toggleItalic().run(),
    },
    { label: 'Code', icon: 'code', glyph: '</>', active: ed.isActive('code'), run: () => chain().toggleCode().run() },
    {
      label: 'Heading',
      icon: '',
      glyph: 'H',
      active: ed.isActive('heading', { level: 2 }),
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Bulleted list',
      icon: 'list-unordered',
      glyph: '•',
      active: ed.isActive('bulletList'),
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: 'list-ordered',
      glyph: '1.',
      active: ed.isActive('orderedList'),
      run: () => chain().toggleOrderedList().run(),
    },
    {
      label: 'Checklist',
      icon: 'checklist',
      glyph: '☐',
      active: ed.isActive('taskList'),
      run: () => chain().toggleTaskList().run(),
    },
    { label: 'Link', icon: 'link', glyph: '🔗', active: ed.isActive('link'), run: openLink },
  ];
});

// ---- Link field (mockup 362-366) -----------------------------------------------------------------
const linkOpen = ref(false);
const linkUrl = ref('');

function openLink(): void {
  linkUrl.value = (editor.value?.getAttributes('link').href as string | undefined) ?? '';
  linkOpen.value = true;
}

function applyLink(): void {
  const url = linkUrl.value.trim();
  linkOpen.value = false;
  if (!/^https?:\/\//.test(url)) return;
  const ed = editor.value;
  if (!ed) return;
  if (ed.state.selection.empty) {
    ed.chain()
      .focus()
      .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
      .run();
  } else {
    ed.chain().focus().setLink({ href: url }).run();
  }
}

function onLinkKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyLink();
  } else if (e.key === 'Escape') {
    linkOpen.value = false;
  }
}

function keepFocus(e: MouseEvent): void {
  e.preventDefault();
}
</script>

<template>
  <div class="flex min-h-35 flex-1 flex-col overflow-hidden rounded-kira-sm border border-border-strong bg-bg">
    <div
      role="toolbar"
      aria-label="Formatting"
      class="flex shrink-0 items-center gap-0.5 border-b border-border bg-chrome px-1.5 py-1"
    >
      <span class="px-1.5 text-kira-sm text-muted-foreground">Notes</span>
      <button
        v-for="btn in toolbar"
        :key="btn.label"
        type="button"
        class="flex h-6 min-w-[26px] items-center justify-center rounded px-1 text-kira-sm"
        :class="btn.active ? 'bg-field text-fg' : 'text-fg'"
        :aria-label="btn.label"
        :aria-pressed="btn.active"
        :title="btn.label"
        data-testid="ade-notes-toolbar-btn"
        @mousedown="keepFocus"
        @click="btn.run"
      >
        <CodiconIcon v-if="btn.icon" :name="btn.icon" :size="12" />
        <span v-else>{{ btn.glyph }}</span>
      </button>
      <template v-if="linkOpen">
        <label for="ade-notes-link" class="sr-only">Link URL</label>
        <Input
          id="ade-notes-link"
          v-model="linkUrl"
          placeholder="https://"
          class="ml-1 h-6 w-[170px] border-dashed font-data text-kira-sm"
          @keydown="onLinkKey"
        />
        <Button variant="dialog" size="sm" class="h-6 shrink-0 px-2" @mousedown="keepFocus" @click="applyLink"
          >Add</Button
        >
      </template>
    </div>
    <EditorContent
      :editor="editor"
      class="min-h-25 flex-1 overflow-auto text-kira-md leading-normal text-fg"
      data-testid="ade-notes-editor"
    />
  </div>
</template>

<style scoped>
/* ProseMirror renders these nodes' own markup (h1-h6, ul/ol/li, code, a, strong, em) directly —
 * Tailwind utility classes can't attach to content the editor generates, so this is the one place
 * in the module that styles via CSS rather than utility classes (§0's library/utility rule: no
 * utility-class path exists for markup we don't emit). */
:deep(.ade-notes-prose) {
  min-height: 100%;
  padding: 10px 12px;
  outline: none;
}
:deep(.ade-notes-prose p) {
  margin: 0 0 0.6em;
}
:deep(.ade-notes-prose p:last-child) {
  margin-bottom: 0;
}
:deep(.ade-notes-prose h1),
:deep(.ade-notes-prose h2),
:deep(.ade-notes-prose h3) {
  margin: 0.4em 0;
  font-weight: 700;
}
:deep(.ade-notes-prose ul),
:deep(.ade-notes-prose ol) {
  margin: 0 0 0.6em;
  padding-left: 1.4em;
}
:deep(.ade-notes-prose ul[data-type='taskList']) {
  padding-left: 0.2em;
  list-style: none;
}
:deep(.ade-notes-prose ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: 0.4em;
}
:deep(.ade-notes-prose li[data-checked='true'] > div) {
  color: var(--kira-fg-subtle);
  text-decoration: line-through;
}
:deep(.ade-notes-prose code) {
  border-radius: 3px;
  background: var(--kira-bg-input);
  padding: 0.1em 0.3em;
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-sm);
}
:deep(.ade-notes-prose a) {
  color: var(--kira-info);
}
:deep(.ade-notes-prose p.is-editor-empty:first-child::before) {
  float: left;
  height: 0;
  color: var(--kira-fg-subtle);
  content: attr(data-placeholder);
  pointer-events: none;
}
</style>
