<script setup lang="ts">
/**
 * `docs/plans/P5.md` W7: §6.4 items 1 and 3 — message at the top of the pane, details at the
 * bottom, with `FileTree.vue` (item 2) between them in `DetailPane.vue`'s own template; this
 * component only ever renders its own two pieces.
 *
 * Every DOM-touching bit (message linkification, ref badges) is built through `linkify.ts`'s
 * `appendLinkifiedText`/`refBadges.ts`'s `buildRefBadges` rather than a template `v-html` — a
 * commit message is untrusted text and this repo's `enableHtmlRendering: false` discipline
 * (`columns.ts`'s own doc comment) applies here just as much as it does inside the grid.
 *
 * G-UX D7 (item 7): subject + files is the pane's whole job now. SHA and Parent(s) are gone
 * entirely — the row context menu's `copySha` is the sha's only copy path left (G19 D7's own
 * precedent), and the graph's own edges are how you reach a parent. Author/Committer and the
 * trailers both moved inside the "Show more" collapsible region, alongside the body, so the
 * collapsed view is subject + clamped body + toggle and nothing else.
 */
import type { PrLookupResult } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { computed, nextTick, ref, watch } from 'vue';
import type { CommitDetail } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import { appendLinkifiedText } from './linkify.ts';
import { buildRefBadges } from './refBadges.ts';

const props = defineProps<{
  detail: CommitDetail | undefined;
  actions: DetailActions;
  /** §6.4's "message, then files, then details" ordering means `DetailPane.vue` has to put its
   *  own `<FileTree>` *between* this component's two halves — so it mounts this component twice,
   *  once per section, rather than this file owning where the tree sits. */
  section: 'message' | 'details';
  /** G24 D12: the currently selected commit's own PR lookup — `PrState.selected`, threaded in by
   *  `DetailPane.vue`. The `'message'` instance never reads this (the row only ever renders in
   *  `'details'`, below). `undefined` covers both "nothing selected yet" and the in-flight/
   *  debounce window, same as `detail` itself before it resolves. */
  prResult?: PrLookupResult;
}>();

const bodyEl = ref<HTMLParagraphElement | null>(null);
const decorationEl = ref<HTMLSpanElement | null>(null);

/** G19 D4 (item 4): the message body's own click-to-expand state, scoped to the `'message'`
 *  section only (the `'details'` instance of this component never reads either ref). Reset to
 *  collapsed on every new commit — an expansion the user made for one commit's message is not a
 *  standing preference carried into the next. */
const bodyExpanded = ref(false);

/** Body lines rendered one `<p>` per blank-line-separated paragraph — `appendLinkifiedText`
 *  handles a paragraph's own line breaks by joining with `\n` inside one paragraph rather than
 *  trying to linkify a single giant string with embedded `<br>`s. */
const bodyParagraphs = computed<string[]>(() => {
  const body = props.detail?.body ?? '';
  if (body.trim() === '') return [];
  return body.split(/\n{2,}/).map((p) => p.trim());
});

function renderBody(): void {
  const container = bodyEl.value;
  if (!container) return;
  container.replaceChildren();
  for (const [index, paragraph] of bodyParagraphs.value.entries()) {
    if (index > 0) container.appendChild(document.createElement('br'));
    if (index > 0) container.appendChild(document.createElement('br'));
    const lines = paragraph.split('\n');
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) container.appendChild(document.createElement('br'));
      appendLinkifiedText(container, line);
    });
  }
}

function renderDecoration(): void {
  const container = decorationEl.value;
  if (!container) return;
  container.replaceChildren();
  // G21 D4: no lane colour here — this panel has no `LayoutStore` row to read one from (its own
  // commit need not even be within the loaded graph window), so its badges keep their kind-only
  // colouring, same as a row whose layout has not arrived yet.
  const badges = buildRefBadges(props.detail?.decoration ?? [], undefined);
  if (badges) container.appendChild(badges);
}

watch(
  [() => props.detail, bodyEl],
  () => {
    bodyExpanded.value = false;
    void nextTick(renderBody);
  },
  { immediate: true },
);
watch([() => props.detail?.decoration, decorationEl], () => void nextTick(renderDecoration), {
  immediate: true,
});

/** §6.4: "author and committer with both timestamps when they differ" — read as: show one
 *  identity row when author and committer are the very same identity at the very same moment
 *  (the overwhelmingly common case), and both, each with its own timestamp, the moment any part
 *  differs (a rebase, a cherry-pick, an `--author` override) — never silently collapse two
 *  genuinely different facts into one row. */
const committerDiffersFromAuthor = computed(() => {
  const detail = props.detail;
  if (!detail) return false;
  return (
    detail.author.name !== detail.committer.name ||
    detail.author.email !== detail.committer.email ||
    detail.author.timestamp !== detail.committer.timestamp
  );
});

const SIGNATURE_TEXT: Readonly<Record<string, string>> = {
  G: 'Good signature',
  B: 'Bad signature',
  U: 'Good signature, unknown validity',
  X: 'Good signature, expired signature',
  Y: 'Good signature, expired key',
  R: 'Good signature, revoked key',
  E: 'Cannot check signature',
};

/** `undefined` for an unsigned commit (`status: "N"`) — §6.4/W7: "an unsigned commit shows no
 *  row, not an empty one". */
const signatureText = computed<string | undefined>(() => {
  const signature = props.detail?.signature;
  if (!signature || signature.status === 'N') return undefined;
  const text = SIGNATURE_TEXT[signature.status] ?? signature.status;
  return signature.signer ? `${text} by ${signature.signer}` : text;
});

/** G24 D12: the one "Pull request" row — resolved with a PR (one line per associated PR),
 *  resolved with none ("No pull request"), or `unavailable` (`Status.Reason` — the ONLY place in
 *  the app that ever tells a user to run `gh auth login`, per upstream D32's "inert, never noisy"
 *  rule applying everywhere else but here). `disabled` renders nothing at all — this computed is
 *  `undefined` for both `disabled` and "nothing resolved yet", collapsing them into the same
 *  "no row" template branch below. */
const PR_STATE_LABEL: Readonly<Record<string, string>> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

interface PrDetailView {
  readonly kind: 'prs' | 'none' | 'unavailable';
  readonly prs: readonly {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly stateLabel: string;
  }[];
  readonly reason: string | undefined;
}

const prDetail = computed<PrDetailView | undefined>(() => {
  const result = props.prResult;
  if (result === undefined || result.kind === 'disabled') return undefined;
  if (result.kind === 'unavailable') {
    return { kind: 'unavailable', prs: [], reason: result.gh.reason ?? 'GitHub did not answer' };
  }
  if (result.prs.length === 0) {
    return { kind: 'none', prs: [], reason: undefined };
  }
  return {
    kind: 'prs',
    reason: undefined,
    prs: result.prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      stateLabel: PR_STATE_LABEL[pr.state] ?? pr.state,
    })),
  };
});

/** G-UX D7 (7b): the whole `'details'` section renders nothing at all when none of its three
 *  rows would — the common case (no decoration on this commit, unsigned, GitHub disabled) is now
 *  an empty pane, not an empty padded box. Reads `detail.decoration.length` directly rather than
 *  `decorationEl?.childNodes.length` (the individual Refs row's own check, unchanged below): this
 *  needs a value known synchronously from props on the FIRST render, before `renderDecoration`'s
 *  own `nextTick` has populated anything — `buildRefBadges` only ever returns `null` for an empty
 *  decoration array (`refBadges.ts`), so this tracks the DOM outcome closely enough to gate on. */
const hasDetails = computed(
  () =>
    (props.detail?.decoration.length ?? 0) > 0 ||
    signatureText.value !== undefined ||
    prDetail.value !== undefined,
);

const COAUTHOR_TOKENS = new Set(['Co-authored-by', 'Signed-off-by']);
const IDENTITY_TRAILER = /^(.*)\s<(.+)>$/;

interface TrailerRow {
  readonly token: string;
  readonly name: string | undefined;
  readonly email: string | undefined;
  readonly raw: string;
}

/** `Co-authored-by`/`Signed-off-by` (§6.4's own two named trailers) parse their `Name <email>`
 *  shape into separate name/email display so the email can be styled as secondary text; every
 *  other trailer renders its value verbatim — this repo does not try to out-guess git's own
 *  trailer syntax for tokens it has not been told carry an identity. */
const trailerRows = computed<TrailerRow[]>(() =>
  (props.detail?.trailers ?? []).map((trailer) => {
    if (COAUTHOR_TOKENS.has(trailer.token)) {
      const match = IDENTITY_TRAILER.exec(trailer.value);
      if (match) {
        const [, name, email] = match;
        return { token: trailer.token, name: name?.trim(), email, raw: trailer.value };
      }
    }
    return { token: trailer.token, name: undefined, email: undefined, raw: trailer.value };
  }),
);

function copyMessage(): void {
  const detail = props.detail;
  if (!detail) return;
  const full = detail.body.trim() === '' ? detail.subject : `${detail.subject}\n\n${detail.body}`;
  props.actions.copy(full, 'commit message');
}
</script>

<template>
  <div
    v-if="detail"
    class="kv-commit-meta"
    :class="{ 'kv-detail-pane-meta--expanded': section === 'message' && bodyExpanded }"
    data-testid="commit-meta"
  >
    <section v-if="section === 'message'" class="kv-meta-message" aria-label="Commit message">
      <div class="kv-meta-message-header">
        <h2 class="kv-meta-subject">{{ detail.subject }}</h2>
        <KuiButton
          v-if="actions.capabilities.clipboard"
          variant="icon"
          icon="codicon-copy"
          v-kui-tooltip="'Copy full message'"
          @click="copyMessage"
        />
      </div>
      <p
        v-if="bodyParagraphs.length > 0"
        ref="bodyEl"
        class="kv-meta-body"
        :class="{ 'kv-meta-body-expanded': bodyExpanded }"
      ></p>
      <!-- G-UX D7 (7a/7b): author/committer and the trailers both live behind this toggle now, so
           it is not gated on `bodyOverflows` any more — there is always at least the author to
           reveal, even for a one-line subject with no body at all. -->
      <KuiButton class="kv-meta-body-toggle" @click="bodyExpanded = !bodyExpanded">
        {{ bodyExpanded ? 'Show less' : 'Show more' }}
      </KuiButton>
      <div v-if="bodyExpanded" class="kv-meta-expanded">
        <p class="kv-meta-identity">{{ detail.author.name }} &lt;{{ detail.author.email }}&gt;</p>
        <p v-if="committerDiffersFromAuthor" class="kv-meta-identity">
          {{ detail.committer.name }} &lt;{{ detail.committer.email }}&gt;
          <span class="kv-meta-identity-role">committer</span>
        </p>
        <dl v-if="trailerRows.length > 0" class="kv-meta-trailers">
          <template v-for="(row, index) in trailerRows" :key="index">
            <dt>{{ row.token }}</dt>
            <dd v-if="row.name !== undefined">
              {{ row.name }} <span class="kv-meta-trailer-email">&lt;{{ row.email }}&gt;</span>
            </dd>
            <dd v-else>{{ row.raw }}</dd>
          </template>
        </dl>
      </div>
    </section>

    <section
      v-if="section === 'details' && hasDetails"
      class="kv-meta-details"
      aria-label="Commit details"
    >
      <dl class="kv-meta-details-list">
        <dt v-if="decorationEl?.childNodes.length">Refs</dt>
        <dd v-show="decorationEl?.childNodes.length" ref="decorationEl" class="kv-meta-refs"></dd>
        <template v-if="signatureText">
          <dt>Signature</dt>
          <dd>{{ signatureText }}</dd>
        </template>
        <template v-if="prDetail">
          <dt>Pull request</dt>
          <dd v-if="prDetail.kind === 'prs'" class="kv-meta-pr">
            <a
              v-for="pr in prDetail.prs"
              :key="pr.number"
              :href="pr.url"
              class="kv-meta-pr-link"
              >#{{ pr.number }} {{ pr.title }} — {{ pr.stateLabel }}</a
            >
          </dd>
          <dd v-else-if="prDetail.kind === 'none'">No pull request</dd>
          <dd v-else class="kv-meta-pr-unavailable" data-testid="pr-unavailable">
            {{ prDetail.reason }}
          </dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style>
/* G-UX D7 (7c): padding/gap tighten one step (space-4 -> space-3/space-2) — one contributor,
   alongside the 2-line clamp below and the deleted sha/parent rows, to the pane's own 80% target
   for the file tree (DetailPane.vue's own max-height rules do the actual bounding). */
.kv-commit-meta {
  padding: var(--kv-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-2);
}

.kv-meta-message-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--kv-s-2);
}

.kv-meta-subject {
  margin: 0;
  font-size: 1em;
  font-weight: 600;
}

.kv-meta-body {
  margin: var(--kv-s-2) 0 0;
  white-space: normal;
}

/* G19 D4 (item 4): truncated while collapsed — F4 confirmed the body used to render in full with
   no truncation at all. G-UX D7 (7c): tightened from 4 lines to 2 — the largest single
   contributor to the pane's 80% target after removing the sha/parent rows; "Show more" is one
   click away for the rest. */
.kv-meta-body:not(.kv-meta-body-expanded) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kv-meta-body a {
  color: var(--kv-focus-border);
}

/* Deliberately not a standard control's box: "Show more"/"Show less" reads as an inline link
   (the same --kv-focus-border blue .kv-meta-body a uses just above), zero-padding and borderless
   by design rather than left over from before the button system existed — no button variant
   models a link, and inventing one for this single caller would be speculative generality. */
.kv-meta-body-toggle {
  margin-top: var(--kv-s-1);
  background: transparent;
  border: none;
  padding: 0;
  color: var(--kv-focus-border);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.kv-meta-body-toggle:hover {
  text-decoration: underline;
}

/* G-UX D7 (7a/7b): the collapsible region behind "Show more" — author/committer identity lines,
   then the trailers. Zero space cost while collapsed (the default view): nothing here renders
   until bodyExpanded is true. */
.kv-meta-expanded {
  margin-top: var(--kv-s-2);
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
}

.kv-meta-identity {
  margin: 0;
  font-size: 0.92em;
  color: var(--kv-description-fg);
}

.kv-meta-identity-role {
  font-size: 0.85em;
}

.kv-meta-trailers {
  margin: var(--kv-s-2) 0 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--kv-s-1) var(--kv-s-4);
  font-size: 0.92em;
}

.kv-meta-trailers dt {
  color: var(--kv-description-fg);
}

.kv-meta-trailers dd {
  margin: 0;
}

.kv-meta-trailer-email {
  color: var(--kv-description-fg);
}

.kv-meta-details-list {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--kv-s-1) var(--kv-s-4);
  font-size: 0.92em;
}

.kv-meta-details-list dt {
  color: var(--kv-description-fg);
}

.kv-meta-details-list dd {
  margin: 0;
}

.kv-meta-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kv-s-1);
}

.kv-meta-pr {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
}

.kv-meta-pr-link {
  color: var(--kv-badge-pr-open-fg);
}

.kv-meta-pr-unavailable {
  color: var(--kv-description-fg);
}
</style>
