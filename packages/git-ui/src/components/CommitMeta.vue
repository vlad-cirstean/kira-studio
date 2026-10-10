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
import type { PrLookupResult, PrRecord } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import AttributeTooltip from '@theme/components/AttributeTooltip.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { cn } from '@theme/lib/utils';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, nextTick, ref, watch } from 'vue';
import type { CommitDetail } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import { prBadgeClass } from './badgeClass.ts';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';
import { appendLinkifiedText } from './linkify.ts';
import { openAllChangesAnnounced } from './openAllChangesAnnounced.ts';
import { buildRefBadges } from './refBadges.ts';

const props = defineProps<{
  detail: CommitDetail | undefined;
  actions: DetailActions;
  /** G24 D12: the currently selected commit's own PR lookup — `PrState.selected`, threaded in by
   *  `DetailPane.vue`. `undefined` covers both "nothing selected yet" and the in-flight/debounce
   *  window, same as `detail` itself before it resolves. */
  prResult?: PrLookupResult;
  /** P74 §4.3: any PR this commit is on (`PrState.prForCommit`, threaded by `DetailPane.vue`) —
   *  drives the facts-row icon, distinct from `prResult` (this exact commit's own "Pull request"
   *  row, only ever populated for the selected commit). `undefined` renders no icon. */
  prForCommit?: readonly PrRecord[];
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
      appendLinkifiedText(container, line, openLink);
    });
  }
}

function renderDecoration(): void {
  const container = decorationEl.value;
  if (!container) return;
  container.replaceChildren();
  const badges = buildRefBadges(props.detail?.decoration ?? []);
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

// P110 A14 (§1.3): a lookup map, not string interpolation, so every text-badge-pr-* class
// Tailwind must scan appears as a complete literal below. Replaces the old dynamic
// `meta-pr-icon--${state}` class, whose own colour rule lived in this file's deleted <style>.
// Inline link: no button chrome, ambient colour, graph font.
const LINK_BUTTON_CLASS =
  'h-auto p-0 border-0 font-normal text-inherit text-graph-sm';

const PR_ICON_CLASS: Readonly<Record<string, string>> = {
  open: 'text-ok',
  draft: 'text-muted-foreground',
  merged: 'text-conn-violet',
  closed: 'text-error',
};

interface PrDetailView {
  readonly kind: 'prs' | 'none' | 'unavailable';
  readonly prs: readonly {
    readonly number: number;
    readonly title: string;
    readonly state: string;
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
      state: pr.state,
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
  await openAllChangesAnnounced(props.actions, { sha: detail.sha, parentIndex: detail.parentIndex });
}

/** P74 §3.3: the "Pull request" row's own external-open action, and (§4.3) the facts-row icon's
 *  — one open path for both, never two. */
async function openPullRequest(number: number): Promise<void> {
  try {
    await props.actions.openPullRequest({ number });
  } catch (err) {
    props.actions.announce(
      `Couldn't open the pull request — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** P79 finding 4: the message body's own linkified URLs (`renderBody`, above) — the same
 *  try/announce shape `openPullRequest` already uses. */
async function openLink(url: string): Promise<void> {
  try {
    await props.actions.openExternalLink(url);
  } catch (err) {
    props.actions.announce(
      `Couldn't open the link — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** P74 §4.3: the facts row's own icon — the first PR `prForCommit` names (ancestry's own
 *  first-writer-wins already resolved which branch wins when more than one claims a commit;
 *  `bySha`'s own array is realistically always length 1 in practice, never fanned out further
 *  here). `undefined` renders nothing, the same "render nothing" rule every other G24 surface
 *  follows. */
const prIcon = computed(() => {
  const first = props.prForCommit?.[0];
  if (!first) return undefined;
  return {
    number: first.number,
    title: first.title,
    state: first.state,
    stateLabel: PR_STATE_LABEL[first.state] ?? first.state,
  };
});
</script>

<template>
  <div
    v-if="detail"
    :class="
      expanded
        ? 'flex flex-col flex-initial min-h-[min(220px,60%)] max-h-7/10 overflow-auto'
        : 'flex flex-col flex-none max-h-1/5 overflow-hidden'
    "
    data-testid="commit-meta"
  >
    <AttributeTooltip :container="decorationEl" />

    <ViewToolbar data-testid="detail-head">
      <Tooltip>
        <TooltipTrigger as-child>
          <span data-testid="meta-subject" class="min-w-0 truncate text-kira-md text-fg">{{ detail.subject }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ detail.subject }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Badge
            as="button"
            type="button"
            class="cursor-pointer"
            aria-label="Copy full SHA"
            data-testid="commit-meta-sha"
            @click="copySha"
          >
            {{ shortSha }}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Copy full SHA</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="shrink-0 text-kira-sm text-subtle">{{ formatRelativeDate(detail.committer.timestamp) }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ formatAbsoluteDate(detail.committer.timestamp) }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="prIcon">
        <TooltipTrigger as-child>
          <Button
            variant="link"
            :class="cn('h-auto p-0 border-0 leading-none', PR_ICON_CLASS[prIcon!.state])"
            :aria-label="`Open pull request #${prIcon!.number} on GitHub`"
            data-testid="commit-meta-pr-icon"
            @click="openPullRequest(prIcon!.number)"
          >
            <CodiconIcon name="github" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{
          `#${prIcon!.number} ${prIcon!.title} — ${prIcon!.stateLabel}`
        }}</TooltipContent>
      </Tooltip>
      <TooltipIconButton
        class="ml-auto"
        icon="diff-multiple"
        label="Open all changes"
        data-testid="open-all-changes-button"
        @click="openAllChanges"
      />
    </ViewToolbar>

    <div class="flex flex-col gap-1 px-3 py-2">
    <p data-testid="meta-body"
      v-if="bodyParagraphs.length > 0"
      ref="bodyEl"
      v-show="expanded"
      class="mt-1 whitespace-normal"
    ></p>

    <Button data-testid="meta-body-toggle"
      variant="link"
      size="kira"
      class="mt-0.5 h-auto p-0 justify-start text-muted-foreground hover:text-fg"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show less' : 'Show more' }}
    </Button>

    <div v-if="expanded" class="flex flex-col gap-1 mt-1">
      <p data-testid="meta-identity" class="text-graph-sm text-muted-foreground">
        {{ detail.author.name }} &lt;{{ detail.author.email }}&gt;
      </p>
      <p data-testid="meta-identity" v-if="committerDiffersFromAuthor" class="text-graph-sm text-muted-foreground">
        {{ detail.committer.name }} &lt;{{ detail.committer.email }}&gt;
        <span class="text-graph-sm">committer</span>
      </p>
      <dl data-testid="meta-trailers"
        v-if="trailerRows.length > 0"
        class="grid grid-cols-[max-content_1fr] gap-y-0.5 gap-x-2 text-graph-sm"
      >
        <template v-for="(row, index) in trailerRows" :key="index">
          <dt class="text-muted-foreground">{{ row.token }}</dt>
          <dd v-if="row.name !== undefined">
            {{ row.name }} <span class="text-muted-foreground">&lt;{{ row.email }}&gt;</span>
          </dd>
          <dd v-else>{{ row.raw }}</dd>
        </template>
      </dl>
      <dl
        v-if="hasDetails"
        class="grid grid-cols-[max-content_1fr] gap-y-0.5 gap-x-2 text-graph-sm"
      >
        <template v-if="detail.decoration.length > 0">
          <dt class="text-muted-foreground">Refs</dt>
          <dd data-testid="meta-refs" ref="decorationEl" class="flex flex-wrap gap-0.5"></dd>
        </template>
        <template v-if="signatureText">
          <dt class="text-muted-foreground">Signature</dt>
          <dd>{{ signatureText }}</dd>
        </template>
        <template v-if="prDetail">
          <dt class="text-muted-foreground">Pull request</dt>
          <dd v-if="prDetail.kind === 'prs'" class="flex flex-col gap-0.5">
            <div
              v-for="pr in prDetail.prs"
              :key="pr.number"
              class="flex items-center gap-0.5"
            >
              <span :class="prBadgeClass(pr.state)">
                {{ pr.stateLabel }}
              </span>
              <Button
                variant="link"
                :class="cn(LINK_BUTTON_CLASS, 'justify-start text-left whitespace-normal')"
                @click="openPullRequest(pr.number)"
              >
                #{{ pr.number }} {{ pr.title }}
              </Button>
            </div>
          </dd>
          <dd v-else-if="prDetail.kind === 'none'">No pull request</dd>
          <dd v-else class="text-muted-foreground" data-testid="pr-unavailable">
            {{ prDetail.reason }}
          </dd>
        </template>
      </dl>
    </div>
    </div>
  </div>
</template>
