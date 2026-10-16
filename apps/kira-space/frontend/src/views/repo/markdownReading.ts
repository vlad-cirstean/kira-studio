// P67c D10/D13: the markdown reading view's own render pipeline — split out of RepoFileView.vue
// for the same reason blameAnnotation.ts is: a whole feature's worth of setup, kept out of the
// view's own script so that file stays about mounting Monaco, not about markdown.
//
// `markdown-it` (MIT, no paid/Enterprise tier) over `marked`: its default `html: false` ESCAPES
// raw HTML in the source rather than passing it through. This view renders a file straight off the
// user's disk inside the app's own privileged WKWebView, so that default removes the need for a
// second dependency (a DOMPurify-style sanitizer) entirely — `marked` would need one bolted on for
// the same result. Do not flip `html` to `true`; that reopens exactly the hole this choice closes.
type MarkdownItInstance = import('markdown-it').MarkdownIt;

let rendererPromise: Promise<MarkdownItInstance> | undefined;

// One renderer instance total (memoized below), so one slug map total — reset in
// `renderMarkdownReading` before each `render()` call rather than per instance, since a fresh Map
// there would otherwise leak collision counters from whichever document rendered previously.
let seenSlugs = new Map<string, number>();

// GitHub's own heading-slug convention (lowercase, spaces to hyphens, strip anything that isn't a
// letter/number/hyphen), good enough to make a same-document `[text](#heading)` link resolve
// without a full parity guarantee for every possible source. Numbered on collision (`-1`, `-2`, …)
// so two same-named headings don't collide onto one id.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadRenderer(): Promise<MarkdownItInstance> {
  if (!rendererPromise) {
    rendererPromise = import('markdown-it').then(({ default: MarkdownIt }) => {
      // `linkify: true` is safe only because every anchor this renderer emits is neutralised at
      // the click handler in RepoFileView.vue (D13) — never actually navigated.
      const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

      md.renderer.rules.heading_open = (tokens, idx, options, _env, renderer) => {
        const inline = tokens[idx + 1];
        let slug = slugify(inline?.type === 'inline' ? inline.content : '') || 'section';
        const collisions = seenSlugs.get(slug) ?? 0;
        seenSlugs.set(slug, collisions + 1);
        if (collisions > 0) slug = `${slug}-${collisions}`;
        tokens[idx].attrSet('id', slug);
        return renderer.renderToken(tokens, idx, options);
      };

      // D13: the href goes on `title` (a hover affordance), never actually followed — see
      // RepoFileView.vue's `onReadingClick`, which `preventDefault()`s every anchor click
      // unconditionally and only ever scrolls a same-page `#anchor` target.
      md.renderer.rules.link_open = (tokens, idx, options, _env, renderer) => {
        const href = tokens[idx].attrGet('href');
        if (href) tokens[idx].attrSet('title', href);
        return renderer.renderToken(tokens, idx, options);
      };

      return md;
    });
  }
  return rendererPromise;
}

/** Renders `text` (raw markdown source) to sanitised HTML — safe to set via `v-html` because
 *  `html: false` above escapes any literal HTML tag in the source rather than passing it through. */
export async function renderMarkdownReading(text: string): Promise<string> {
  const md = await loadRenderer();
  seenSlugs = new Map<string, number>();
  return md.render(text);
}
