import MarkdownIt from 'markdown-it';

// Descriptions and comments come from other people. Raw HTML is never emitted: comments and tags
// drop, the text between inline tags stays, and a block's tags strip to escaped text. Images render
// as links so nothing loads from a remote host.
const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });

const SAFE_LINK = /^(?:https?:|mailto:|#)/i;
const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url) => defaultValidateLink(String(url)) && SAFE_LINK.test(String(url).trim());

const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?[A-Za-z][^>]*>/g;

md.renderer.rules.html_inline = () => '';
md.renderer.rules.html_block = (tokens, idx) => {
  const text = (tokens[idx]?.content ?? '').replace(COMMENT, '').replace(TAG, '').trim();
  return text ? `<p>${md.utils.escapeHtml(text)}</p>\n` : '';
};

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = String(token?.attrGet('src') ?? '');
  const alt = md.utils.escapeHtml(token?.content || 'image');
  const href = md.utils.escapeHtml(src);
  return `<a href="${href}" title="${href}">[image: ${alt}]</a>`;
};

md.renderer.rules.link_open = (tokens, idx, options, _env, renderer) => {
  const href = tokens[idx]?.attrGet('href');
  if (href) tokens[idx]?.attrSet('title', href);
  return renderer.renderToken(tokens, idx, options);
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}
