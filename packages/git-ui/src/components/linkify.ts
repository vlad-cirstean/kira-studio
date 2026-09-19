/**
 * P5 W7's message-body URL linkification (§6.4). `docs/plans/P5.md`'s own decision: "v1 P5
 * renders URLs as `<a href>` and lets the host's own webview link handling take them" — no
 * `ExternalOpener` port, because VS Code already opens a webview link natively. Issue references
 * (`#123`) are deliberately left as plain text: without §6.7's repository resolution there is
 * nothing to link them to, and a link that goes nowhere is worse than plain text (recorded as an
 * open item for P12).
 *
 * Split in two, matching `refBadges.ts`'s own precedent: `linkifySegments` is pure and unit
 * tested directly (the boundary case worth a test — trailing sentence punctuation is not part of
 * the URL); `appendLinkifiedText` is the thin DOM-construction layer (elements built as DOM,
 * never `innerHTML`) `CommitMeta.vue` calls per line of the message body.
 *
 * P79 finding 4: a URL segment used to build a real `<a href>` — under the Wails desktop app,
 * which has no anchor-click interception, clicking one navigated the whole app window off the app
 * with no way back, exactly the hazard `CommitMeta.vue`'s PR row was fixed to avoid one component
 * over (P74 §3.3). `appendLinkifiedText` now takes `onOpenExternal` (`undefined` when the host
 * cannot open external URLs at all) and builds a `<button>` that calls it, or plain inert text
 * when there is none — the same "button when capable, inert text otherwise" shape the PR row
 * already established, never a raw `<a>` either way.
 */
type LinkifiedSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly url: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Trailing punctuation a sentence commonly puts right after a URL — a period ending the
 *  sentence, a comma, a closing paren with no matching open paren inside the match — is peeled
 *  back off before the link is built, matching the convention most link-detecting renderers
 *  (GitHub, chat clients) already follow. */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url.charAt(end - 1);
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') {
      end--;
      continue;
    }
    if (ch === ')' && !url.slice(0, end - 1).includes('(')) {
      end--;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

function linkifySegments(text: string): LinkifiedSegment[] {
  const segments: LinkifiedSegment[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = URL_PATTERN.exec(text);
  while (match !== null) {
    const start = match.index;
    const url = trimTrailingPunctuation(match[0]);
    if (url.length === 0) {
      match = URL_PATTERN.exec(text);
      continue;
    }
    if (start > lastIndex) segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    segments.push({ kind: 'link', url });
    lastIndex = start + url.length;
    URL_PATTERN.lastIndex = lastIndex;
    match = URL_PATTERN.exec(text);
  }
  if (lastIndex < text.length) segments.push({ kind: 'text', text: text.slice(lastIndex) });
  return segments;
}

/** Appends one line's worth of linkified DOM to `parent` — a text node per plain-text segment,
 *  and per URL segment: a `<button class="kv-linkify-url">` calling `onOpenExternal` when given,
 *  or a plain text node (matching `CommitMeta.vue`'s PR row's own inert-text sibling) when
 *  `onOpenExternal` is `undefined` — never a raw `<a href>` (P79 finding 4). */
export function appendLinkifiedText(
  parent: HTMLElement,
  text: string,
  onOpenExternal: ((url: string) => void) | undefined,
): void {
  for (const segment of linkifySegments(text)) {
    if (segment.kind === 'text') {
      parent.appendChild(document.createTextNode(segment.text));
      continue;
    }
    if (!onOpenExternal) {
      parent.appendChild(document.createTextNode(segment.url));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kv-linkify-url';
    button.textContent = segment.url;
    button.addEventListener('click', () => onOpenExternal(segment.url));
    parent.appendChild(button);
  }
}
