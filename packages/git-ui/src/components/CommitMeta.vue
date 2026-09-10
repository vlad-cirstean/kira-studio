<script setup lang="ts">
/**
 * `docs/plans/P5.md` W7: subject + files is `DetailPane.vue`'s whole job — this component renders
 * the subject/facts/actions header and, behind one "Show more" toggle, everything else about the
 * commit (body, author/committer identities, trailers, refs, signature, pull request).
 *
 * Every DOM-touching bit (message linkification, ref badges) is built through `linkify.ts`'s
 * `appendLinkifiedText`/`refBadges.ts`'s `buildRefBadges` rather than a template `v-html` — a
 * commit message is untrusted text and this repo's `enableHtmlRendering: false` discipline
 * (`columns.ts`'s own doc comment) applies here just as much as it does inside the grid.
 *
 * G-UX (items 6/7): `DetailPane.vue` used to mount this component twice — once for the message
 * (with the body/author/trailers behind "Show more"), once more, physically below the file tree,
 * for Refs/Signature/Pull request. That second, separately-scrolling instance is gone: this file
 * now mounts once and folds Refs/Signature/PR into the same "Show more" region as the body and
 * identities, so there is exactly one expandable region, not two disconnected ones. The collapsed
 * view is now title + a date/SHA facts row + "Open all changes" — no body preview at all (it used
 * to show a 2-line clamp before the toggle); "Show more" reveals the rest. The old copy-message
 * icon button is gone too — SHA/message copy already exist via the row context menu, and the new
 * facts row's SHA button covers the one copy path this pane itself offers.
 */
import type { PrLookupResult } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { computed, nextTick, ref, watch } from 'vue';
import type { CommitDetail } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';
import { appendLinkifiedText } from './linkify.ts';
import { buildRefBadges } from './refBadges.ts';

const props = defineProps<{
  detail: CommitDetail | undefined;
  actions: DetailActions;
  /** G24 D12: the currently selected commit's own PR lookup — `PrState.selected`, threaded in by
   *  `DetailPane.vue`. `undefined` covers both "nothing selected yet" and the in-flight/debounce
   *  window, same as `detail` itself before it resolves. */
  prResult?: PrLookupResult;
}>();

const bodyEl = ref<HTMLParagraphElement | null>(null);
const decorationEl = ref<HTMLSpanElement | null>(null);

/** G-UX (items 6/7): the one "Show more" state for the whole pane now — gates the body, the
 *  identities, the trailers, and Refs/Signature/PR together. Reset to collapsed on every new
 *  commit — an expansion the user made for one commit is not a standing preference carried into
 *  the next. */
const expanded = ref(false);

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

/** `bodyEl` stays mounted (see the template) whether or not the pane is expanded — only its own
 *  visibility toggles — precisely so this watch, and the render it drives, never has to re-run
 *  just because the user clicked "Show more"; it only reacts to an actual commit/body change. */
watch(
  [() => props.detail, bodyEl],
  () => {
    expanded.value = false;
    void nextTick(renderBody);
  },
  { immediate: true },
);
/** `decorationEl`, unlike `bodyEl`, only exists in the DOM while `expanded` — nothing here sets
 *  `expanded` itself, so mounting/unmounting it as the toggle flips is safe and simply re-renders
 *  the badges into place the next time it appears. */
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

/** Whether the Refs/Signature/PR block has anything to show at all — the common case (no
 *  decoration on this commit, unsigned, GitHub disabled) renders none of it, not an empty padded
 *  box. Reads `detail.decoration.length` directly rather than `decorationEl?.childNodes.length`
 *  (the individual Refs row's own check, unchanged below): this needs a value known synchronously
 *  from props, before `renderDecoration`'s own `nextTick` has populated anything, and before
 *  `decorationEl` even exists in the DOM (it is only mounted while `expanded`) —
 *  `buildRefBadges` only ever returns `null` for an empty decoration array (`refBadges.ts`), so
 *  this tracks the DOM outcome closely enough to gate on. */
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

const shortSha = computed(() => props.detail?.sha.slice(0, 7) ?? '');

/** G-UX (item 6): the facts row's own copy path — the only sha-copy affordance this pane offers
 *  now (the old header copy button copied the full *message*, not the sha, and is gone). */
function copySha(): void {
  const sha = props.detail?.sha;
  if (!sha) return;
  props.actions.copy(sha, 'full SHA');
}

/** G-UX (item 6): replaces the old copy-message header button — "Open all changes", the exact
 *  pattern `ReviewCommitRow.vue`'s own row action already uses. Unlike that row, this pane's
 *  `detail` always already carries the full file list (no lazy per-row fetch to guard against
 *  here), so there is no "expand first" precondition to check. */
async function openAllChanges(): Promise<void> {
  const detail = props.detail;
  if (!detail) return;
  try {
    const { opened, failed, mode } = await props.actions.openAllChanges({
      sha: detail.sha,
      parentIndex: detail.parentIndex,
    });
    props.actions.announce(
      failed === 0
        ? mode === 'multiDiff'
          ? `Opened all ${opened} changed files`
          : `Opened ${opened} files`
        : `Opened ${opened} of ${opened + failed} files — ${failed} couldn't be opened`,
    );
  } catch (err) {
    props.actions.announce(
      `Couldn't open the changes — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
</script>

<template>
  <div
    v-if="detail"
    class="kv-commit-meta"
    :class="{ 'kv-detail-pane-meta--expanded': expanded }"
    data-testid="commit-meta"
  >
    <div class="kv-meta-header">
      <h2 class="kv-meta-subject">{{ detail.subject }}</h2>
      <KuiButton
        variant="icon"
        icon="codicon-diff-multiple"
        v-kui-tooltip="'Open all changes'"
        aria-label="Open all changes"
        data-testid="open-all-changes-button"
        @click="openAllChanges"
      />
    </div>

    <p class="kv-meta-facts">
      <span v-kui-tooltip="formatAbsoluteDate(detail.committer.timestamp)">{{
        formatRelativeDate(detail.committer.timestamp)
      }}</span>
      <span class="kv-meta-facts-sep" aria-hidden="true">·</span>
      <button
        v-if="actions.capabilities.clipboard"
        type="button"
        class="kv-meta-sha"
        v-kui-tooltip="'Copy full SHA'"
        aria-label="Copy full SHA"
        data-testid="commit-meta-sha"
        @click="copySha"
      >
        {{ shortSha }}
      </button>
      <code v-else class="kv-meta-sha-static" data-testid="commit-meta-sha">{{ shortSha }}</code>
    </p>

    <p
      v-if="bodyParagraphs.length > 0"
      ref="bodyEl"
      v-show="expanded"
      class="kv-meta-body"
    ></p>

    <KuiButton class="kv-meta-body-toggle" @click="expanded = !expanded">
      {{ expanded ? 'Show less' : 'Show more' }}
    </KuiButton>

    <div v-if="expanded" class="kv-meta-expanded">
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
      <dl v-if="hasDetails" class="kv-meta-details-list">
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
    </div>
  </div>
</template>

<style>
.kv-commit-meta {
  padding: var(--kv-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-2);
}

.kv-meta-header {
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

/* G-UX (item 6): the date + short-SHA row — visible even while collapsed, alongside the title and
   the "Open all changes" action. */
.kv-meta-facts {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

.kv-meta-facts-sep {
  flex-shrink: 0;
}

.kv-meta-sha {
  font-family: var(--kv-mono-font-family);
  color: inherit;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.kv-meta-sha:hover {
  text-decoration: underline;
}

.kv-meta-sha-static {
  font-family: var(--kv-mono-font-family);
}

.kv-meta-body {
  margin: var(--kv-s-2) 0 0;
  white-space: normal;
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

/* G-UX (items 6/7): the collapsible region behind "Show more" — body, author/committer identity,
   trailers, then Refs/Signature/Pull request, all folded into the one region. Zero space cost
   while collapsed (the default view): nothing here renders until `expanded` is true. */
.kv-meta-expanded {
  margin-top: var(--kv-s-2);
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-2);
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
  margin: 0;
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
