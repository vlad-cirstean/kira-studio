// Real-interaction fix (reported bug — the {{variable}} hover tooltip "looks horrible": the value
// and its explanation ran together, all in one undifferentiated block of monospace lines, and a
// JSON-shaped value rendered as a single truncated line rather than something readable).
//
// bun test has no real DOM (no jsdom/happy-dom in this workspace — column-widths-cache.spec.ts's
// own minimal document stub is the precedent), so buildHoverSource's create() is driven against a
// small fake `document` here too: just enough of createElement/appendChild to record which
// class/tagName/text each child got, in order — not a spec-compliant DOM, but enough to prove the
// actual structure buildHoverSource emits (the thing a real browser would then paint), not just
// the ConsoleHoverInfo shape a caller hands it.
import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import type { Tooltip } from '@codemirror/view';
import {
  buildHoverSource,
  type ConsoleHoverInfo,
  formatHoverValue,
} from '../../frontend/src/editor/hover';

describe('formatHoverValue — pretty-prints a JSON-shaped value, leaves anything else verbatim', () => {
  test('a JSON object re-indents', () => {
    expect(formatHoverValue('{"a":1,"b":"x"}')).toBe('{\n  "a": 1,\n  "b": "x"\n}');
  });

  test('a JSON array re-indents', () => {
    expect(formatHoverValue('[1,2,3]')).toBe('[\n  1,\n  2,\n  3\n]');
  });

  test('a bare string value (the common case — most variables are not JSON) is unchanged', () => {
    expect(formatHoverValue('https://api.example.com')).toBe('https://api.example.com');
  });

  test('invalid/non-JSON text is unchanged, not a throw', () => {
    expect(() => formatHoverValue('not { json at all')).not.toThrow();
    expect(formatHoverValue('not { json at all')).toBe('not { json at all');
  });
});

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  children: FakeEl[];
  appendChild(child: FakeEl): void;
}

function fakeElement(tagName: string): FakeEl {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    appendChild(child: FakeEl) {
      this.children.push(child);
    },
  };
}

const originalDocument = (globalThis as { document?: unknown }).document;

function withFakeDocument<T>(run: () => T): T {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => fakeElement(tag),
  };
  try {
    return run();
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
}

function fakeView(doc: string) {
  const state = EditorState.create({ doc });
  return { state } as unknown as Parameters<ReturnType<typeof buildHoverSource>>[0];
}

// buildHoverSource's own implementation always returns a plain `Tooltip | null` synchronously
// (hover.ts's own return type on the function it builds) — narrower than HoverTooltipSource's
// full external signature (which also allows a Promise or an array, neither of which this
// function ever produces), so this cast is safe for every case these tests drive.
function runSource(
  source: ReturnType<typeof buildHoverSource>,
  doc: string,
  pos: number,
): Tooltip | null {
  return source(fakeView(doc), pos, -1) as Tooltip | null;
}

describe('buildHoverSource — the value/caption DOM split it actually builds', () => {
  test('info.value renders first, as its own .cm-kira-hover-value <pre> block; info.lines become .cm-kira-hover-caption underneath it', () => {
    withFakeDocument(() => {
      const info: ConsoleHoverInfo = {
        from: 0,
        to: 3,
        value: '{\n  "a": 1\n}',
        lines: ['environment variable'],
      };
      const source = buildHoverSource(() => info);
      const tooltip = runSource(source, 'abc', 0);
      expect(tooltip).not.toBeNull();
      // hover.ts's own create() ignores its argument entirely (ConsoleHoverInfo carries
      // everything it needs already) — a real EditorView is never touched, so this is safe.
      const dom = tooltip?.create({} as never).dom as unknown as FakeEl;

      expect(dom.children).toHaveLength(2);
      const [valueEl, captionEl] = dom.children;
      expect(valueEl?.tagName).toBe('PRE'); // pre-wrapped — a multi-line value keeps its indentation
      expect(valueEl?.className).toBe('cm-kira-hover-value');
      expect(valueEl?.textContent).toBe('{\n  "a": 1\n}');
      expect(captionEl?.className).toBe('cm-kira-hover-caption');
      expect(captionEl?.textContent).toBe('environment variable');
    });
  });

  test('without info.value, every existing caller (sqlHover.ts) renders exactly as before: plain .cm-kira-hover-line, no value block', () => {
    withFakeDocument(() => {
      const info: ConsoleHoverInfo = { from: 0, to: 3, lines: ['users (table)', '  id  integer'] };
      const source = buildHoverSource(() => info);
      const tooltip = runSource(source, 'abc', 0);
      // hover.ts's own create() ignores its argument entirely (ConsoleHoverInfo carries
      // everything it needs already) — a real EditorView is never touched, so this is safe.
      const dom = tooltip?.create({} as never).dom as unknown as FakeEl;

      expect(dom.children).toHaveLength(2);
      expect(dom.children.every((c) => c.className === 'cm-kira-hover-line')).toBe(true);
      expect(dom.children.map((c) => c.textContent)).toEqual(['users (table)', '  id  integer']);
    });
  });

  test('a deferred/secret reference (no value to show) renders its one explanation line as .cm-kira-hover-line, not a stray empty value block', () => {
    withFakeDocument(() => {
      const info: ConsoleHoverInfo = {
        from: 0,
        to: 3,
        lines: ['secret — resolved when the request is sent'],
      };
      const source = buildHoverSource(() => info);
      const tooltip = runSource(source, 'abc', 0);
      // hover.ts's own create() ignores its argument entirely (ConsoleHoverInfo carries
      // everything it needs already) — a real EditorView is never touched, so this is safe.
      const dom = tooltip?.create({} as never).dom as unknown as FakeEl;

      expect(dom.children).toHaveLength(1);
      expect(dom.children[0]?.className).toBe('cm-kira-hover-line');
    });
  });
});
