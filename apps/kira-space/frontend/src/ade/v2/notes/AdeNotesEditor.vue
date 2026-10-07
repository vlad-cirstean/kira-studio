<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { control } from '../../../bridge/control';
import { notesExtensions } from './notesExtensions';

// Notes editor: TipTap + `@tiptap/markdown`. Loads and saves Markdown only; ProseMirror JSON never
// reaches the wire.
const props = defineProps<{
  notes: string;
  itemId: string;
}>();

const emit = defineEmits<{ save: [itemId: string, value: string] }>();

let lastEmitted = props.notes;
// The item the editor text currently belongs to; lags `props.itemId` until the switch watcher runs.
let contentItemId = props.itemId;

function flush(): void {
  const ed = editor.value;
  if (!ed) return;
  const md = ed.getMarkdown();
  if (md !== lastEmitted) {
    lastEmitted = md;
    emit('save', contentItemId, md);
  }
}

const debouncedFlush = useDebounceFn(flush, 600);

const PROSE = [
  'ade-notes-prose min-h-full px-3 py-2.5 outline-none',
  '[&_p]:mb-[0.6em] [&_p:last-child]:mb-0',
  '[&_h1]:my-[0.4em] [&_h1]:font-bold [&_h2]:my-[0.4em] [&_h2]:font-bold [&_h3]:my-[0.4em] [&_h3]:font-bold',
  '[&_ul]:mb-[0.6em] [&_ul]:list-disc [&_ul]:pl-[1.4em] [&_ol]:mb-[0.6em] [&_ol]:list-decimal [&_ol]:pl-[1.4em]',
  "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-[0.2em]",
  "[&_ul[data-type='taskList']_li]:flex [&_ul[data-type='taskList']_li]:items-start [&_ul[data-type='taskList']_li]:gap-[0.4em]",
  "[&_input[type='checkbox']]:cursor-pointer [&_input[type='checkbox']]:accent-ok",
  "[&_li[data-checked='true']>div]:text-subtle [&_li[data-checked='true']>div]:line-through",
  '[&_code]:rounded-kira-xs [&_code]:bg-field [&_code]:px-[0.3em] [&_code]:py-[0.1em] [&_code]:font-data [&_code]:text-kira-sm',
  '[&_a]:text-info',
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-subtle [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
].join(' ');

const editor = useEditor({
  content: props.notes,
  contentType: 'markdown',
  extensions: notesExtensions(),
  editorProps: {
    attributes: { class: PROSE, 'aria-label': 'Notes' },
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

// Re-set content on an item switch (after flushing the outgoing item's pending edit), or when
// incoming `notes` differs from the last emit and the editor is unfocused; never mid-edit.
watch(
  () => props.itemId,
  () => {
    flush();
    contentItemId = props.itemId;
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

// Toolbar: codicon where the theme has one, else the glyph text.
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
      <Button
        v-for="btn in toolbar"
        :key="btn.label"
        :variant="btn.active ? 'dialog' : 'toolbar'"
        size="kira-icon"
        class="text-kira-sm"
        :aria-label="btn.label"
        :aria-pressed="btn.active"
        :title="btn.label"
        data-testid="ade-notes-toolbar-btn"
        @mousedown="keepFocus"
        @click="btn.run"
      >
        <CodiconIcon v-if="btn.icon" :name="btn.icon" :size="12" />
        <span v-else>{{ btn.glyph }}</span>
      </Button>
      <template v-if="linkOpen">
        <label for="ade-notes-link" class="sr-only">Link URL</label>
        <Input
          id="ade-notes-link"
          v-model="linkUrl"
          placeholder="https://"
          size="kira"
          class="ml-1 w-42.5 border-dashed font-data"
          @keydown="onLinkKey"
        />
        <Button variant="dialog" size="kira" class="shrink-0" @mousedown="keepFocus" @click="applyLink"
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
