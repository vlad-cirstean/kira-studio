package gitrpc

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// AppInitResult is the server contract's own app.init — the webview contract's AppInitResult minus
// host/capabilities/settings, all three of which are properties of the editor, not of Kira Studio
// (SPEC §5 item 3; D11). The extension composes the full result from its own ports plus this.
type AppInitResult struct {
	ContractVersion int                 `json:"contractVersion"`
	ServerVersion   string              `json:"serverVersion"`
	Git             gitclient.GitStatus `json:"git"`
}

// RepoOpenParams is repo.open's request — @kira/git-ipc's own shape (a bare path).
type RepoOpenParams struct {
	Path string `json:"path"`
}

// RepoCloseParams is repo.close's request.
type RepoCloseParams struct {
	RepoID string `json:"repoId"`
}

// RepoOpenResult is repo.open's result — structurally matches @kira/git-ipc's own RepoOpenResult
// union. Moved here from gitclient/client.go (D18): it is a wire type, and SPEC §2 makes gitrpc the
// owner of wire types — gitclient itself no longer has an opinion on repo.open's shape. JSON tags
// unchanged. A classified error other than "not a repository" (permission denied, an unexpected
// spawn failure) is not one of this union's members and crosses as a plain RpcError instead
// (mapGitError, handlers.go).
type RepoOpenResult struct {
	Kind string                 `json:"kind"` // "ok" | "notARepository" | "gitUnavailable"
	Repo *gitclient.RepoSummary `json:"repo,omitempty"`
	Path string                 `json:"path,omitempty"`
	Git  *gitclient.GitStatus   `json:"git,omitempty"`
}

// ---------------------------------------------------------------------------------------
// graph.* (D14) — @kira/git-ipc's own CommitRange/graph.* request and stream shapes.
// ---------------------------------------------------------------------------------------

// CommitRangeParams is CommitRange's wire shape — @kira/git-ipc's own CommitRange, the
// <base>..<branch> a graph.* call's `range` selects (G6 D2: the SAME WalkSpec.Range every scoped
// walk already carries, not a second shape).
type CommitRangeParams struct {
	Base   string `json:"base"`
	Branch string `json:"branch"`
}

// ---------------------------------------------------------------------------------------
// search.run (G23 D13) -- @kira/git-ipc's own SearchQueryParams/SearchRunResult, commits-only
// (no `scope`: refs/both are resolved entirely client-side, contract.ts:900-903).
// ---------------------------------------------------------------------------------------

// SearchQueryParams is search.run's own query shape — @kira/git-ipc's SearchQueryParams verbatim.
type SearchQueryParams struct {
	Text          string `json:"text"`
	CaseSensitive bool   `json:"caseSensitive"`
	WholeWord     bool   `json:"wholeWord"`
	Regex         bool   `json:"regex"`
}

// SearchRunParams is search.run's request.
type SearchRunParams struct {
	RepoID string            `json:"repoId"`
	Query  SearchQueryParams `json:"query"`
	Limit  *int              `json:"limit,omitempty"`
}

// SearchHit is one matched commit — @kira/git-ipc's own CommitSearchHit.
type SearchHit struct {
	SHA         string   `json:"sha"`
	Subject     string   `json:"subject"`
	AuthorName  string   `json:"authorName"`
	AuthorEmail string   `json:"authorEmail"`
	AuthorTime  int64    `json:"authorTime"`
	Fields      []string `json:"fields"`
}

// SearchRunResult is search.run's result — @kira/git-ipc's own three-member SearchRunResult
// union, flattened onto one struct the way RepoOpenResult already is (Kind selects which fields
// are meaningful): "ok" | "invalidPattern" | "unsupportedPattern" (D6 — the new member this
// phase adds, for a `regex`-mode pattern using syntax RE2 cannot express at all).
type SearchRunResult struct {
	Kind string `json:"kind"`

	// "ok"
	Hits      []SearchHit `json:"hits"`
	Total     int         `json:"total"`
	Truncated bool        `json:"truncated"`
	Scanned   int         `json:"scanned"`
	Complete  bool        `json:"complete"`

	// "invalidPattern" | "unsupportedPattern"
	Message string `json:"message,omitempty"`
}

type GraphStatusParams struct {
	RepoID string             `json:"repoId"`
	Range  *CommitRangeParams `json:"range,omitempty"`
}

type GraphStatusResult struct {
	Loaded    int  `json:"loaded"`
	Remaining int  `json:"remaining"`
	Exhausted bool `json:"exhausted"`
}

type GraphLoadMoreParams struct {
	RepoID string             `json:"repoId"`
	Pages  *int               `json:"pages,omitempty"`
	Range  *CommitRangeParams `json:"range,omitempty"`
	// Scope/PageSize (D6): optional, injected by the extension from the window's own
	// kiraVersion.graph.* settings. Absent for every raw socket client (every Go integration
	// test included) — the server defaults them (walkSpecFrom, graph.go).
	Scope    string `json:"scope,omitempty"`
	PageSize *int   `json:"pageSize,omitempty"`
}

type GraphLoadMoreResult struct {
	Started bool `json:"started"`
}

type GraphRefreshParams struct {
	RepoID string `json:"repoId"`
}

type GraphRefreshResult struct {
	Restarted bool `json:"restarted"`
}

type GraphStreamParams struct {
	RepoID           string             `json:"repoId"`
	ResumeThroughRow *int               `json:"resumeThroughRow,omitempty"`
	Range            *CommitRangeParams `json:"range,omitempty"`
	Scope            string             `json:"scope,omitempty"`
	PageSize         *int               `json:"pageSize,omitempty"`
}

// commitsBlob marshals as {"$fb":"gitwire/1","d":{"$blob":true}} — D4's own marker naming where
// the frame's out-of-band FlatBuffer belongs once rpcstream/socketChannel.ts substitutes it.
// rpcstream never learns what a graph chunk is (session.go:1-9's own module doc); this is the one
// place that shape is stated.
type commitsBlob struct{}

func (commitsBlob) MarshalJSON() ([]byte, error) {
	return []byte(`{"$fb":"gitwire/1","d":{"$blob":true}}`), nil
}

// ---------------------------------------------------------------------------------------
// commit.detail/commit.fileDiff/file.read/file.goToTarget (D3, D6) — @kira/git-ipc's own request
// shapes. Results are gitsession's own wire-shaped types (porcelain.CommitDetail,
// gitsession.FileDiffResult/BlobResult/GoToTarget) — D5's own precedent (gitclient.RepoSummary
// crossing the wire directly) applied again: no second, gitrpc-owned copy of a shape gitsession
// already produces JSON-tagged.
// ---------------------------------------------------------------------------------------

// MaxResultBytes is D2(b)'s own cap on commit.fileDiff/file.read's *encoded* result — comfortably
// under gitsock's 8 MiB frame cap, far above anything a 1 MiB patch (gitsession.MaxPatchBytes)
// produces in practice (F9: ~2.5 MiB worst realistic case). Not measured against a real budget —
// there is no decision this number would change.
const MaxResultBytes = 6 << 20

type CommitDetailParams struct {
	RepoID      string `json:"repoId"`
	SHA         string `json:"sha"`
	ParentIndex *int   `json:"parentIndex,omitempty"`
}

type CommitFileDiffParams struct {
	RepoID       string  `json:"repoId"`
	SHA          string  `json:"sha"`
	Path         string  `json:"path"`
	OriginalPath *string `json:"originalPath,omitempty"`
	ParentIndex  *int    `json:"parentIndex,omitempty"`
}

// FileReadParams is file.read's own request — a server-only method (D3): never called by the
// webview, only by the extension's own virtual-document source (D14).
type FileReadParams struct {
	RepoID string `json:"repoId"`
	Rev    string `json:"rev"`
	Path   string `json:"path"`
}

// FileGoToTargetParams is file.goToTarget's own request — a server-only method (D3): the
// extension maps the returned hunks across the drift itself (D4), over @kira/git-core's own
// already-tested mapLineAcrossDiff.
type FileGoToTargetParams struct {
	RepoID string `json:"repoId"`
	Rev    string `json:"rev"`
	Path   string `json:"path"`
}

// BlameLineParams is blame.line's own request (P5) — a server-only method: no webview caller
// exists yet, only the extension's own status-bar widget. line is 1-based. No rev/atSha field —
// blame.line always blames the working tree, never a historical revision (P5's own plan, §7).
type BlameLineParams struct {
	RepoID string `json:"repoId"`
	Path   string `json:"path"`
	Line   int    `json:"line"`
}

// WorkingDetailParams is working.detail's own request (P7, item 2) — the uncommitted-changes
// strip's click-through, mirroring commit.detail's own params minus the sha this method has none
// of.
type WorkingDetailParams struct {
	RepoID string `json:"repoId"`
}

// workingDetailResult is working.detail's own wire result — a bare `readonly FileChange[]` at the
// contract layer, wrapped in one field here purely because a JSON-RPC result is always an object,
// never a bare array (the same reason commit.fileDiff's own result wraps its FileDiffBody).
type workingDetailResult struct {
	Files []porcelain.FileChange `json:"files"`
}

// graphChunk is graph.stream's chunk envelope — @kira/git-ipc's own StreamChunkOf<'graph.stream'>
// field for field, with `commits` replaced by the D4 marker above.
type graphChunk struct {
	RepoID    string      `json:"repoId"`
	Seq       int         `json:"seq"`
	From      int         `json:"from"`
	To        int         `json:"to"`
	Source    string      `json:"source"` // "git" | "cache"
	Remaining int         `json:"remaining"`
	Exhausted bool        `json:"exhausted"`
	Commits   commitsBlob `json:"commits"`
}

// ---------------------------------------------------------------------------------------
// P6 (G5) — refs, status, pre-flight and operations (D20). Results are gitsession's/
// gitpreflight's own wire-shaped types (RefsResult, StatusSummary, CheckoutPreflight,
// RevertPreflight, OpResult, UndoSlotSnapshot) — D5's own precedent applied again: no second,
// gitrpc-owned copy of a shape those packages already produce JSON-tagged. CONTRACT_VERSION stays
// 14 (D1): every one of these seven request keys, and every P6 type, has been in contract.ts/
// validate.ts since G1.
// ---------------------------------------------------------------------------------------

type RefsListParams struct {
	RepoID string `json:"repoId"`
}

type StatusGetParams struct {
	RepoID string `json:"repoId"`
}

type PreflightCheckoutParams struct {
	RepoID string `json:"repoId"`
	Target string `json:"target"`
	Mode   string `json:"mode"` // "switch" | "detach"
}

type PreflightRevertParams struct {
	RepoID   string   `json:"repoId"`
	Shas     []string `json:"shas"`
	Mainline *int     `json:"mainline,omitempty"`
}

// PreflightResetParams is preflight.reset's own request (§7.7).
type PreflightResetParams struct {
	RepoID string `json:"repoId"`
	Target string `json:"target"`
	Mode   string `json:"mode"` // "soft" | "mixed" | "hard"
}

// PreflightCherryPickParams is preflight.cherryPick's own request (§7.13).
type PreflightCherryPickParams struct {
	RepoID   string `json:"repoId"`
	SHA      string `json:"sha"`
	Mainline *int   `json:"mainline,omitempty"`
}

// OpRunParams is op.run's own request — Op is gitsession's own flattened decode of the wire's
// nineteen-member OpRequest union (D5).
type OpRunParams struct {
	RepoID string               `json:"repoId"`
	Op     gitsession.OpRequest `json:"op"`
}

type UndoPeekParams struct {
	RepoID string `json:"repoId"`
}

// UndoPeekResult mirrors @kira/git-ipc's own undo.peek result — `{slot: UndoSlotSnapshot | null}`.
type UndoPeekResult struct {
	Slot *gitpreflight.UndoSlotSnapshot `json:"slot"`
}

type UndoRunParams struct {
	RepoID string `json:"repoId"`
	ID     string `json:"id"`
}

// ---------------------------------------------------------------------------------------
// G17 — stash. Results are gitsession's/gitpreflight's own wire-shaped types
// ([]porcelain.StashEntry wrapped in StashListResult, gitsession.StashShowResult,
// gitpreflight.StashPopPreflight, gitpreflight.StashBranchPreflight) — D5's own precedent applied
// again: no second, gitrpc-owned copy of a shape those packages already produce JSON-tagged.
// CONTRACT_VERSION stays 21 (F1): every one of these four request keys, and every stash type, has
// been in contract.ts/validate.ts since G1.
// ---------------------------------------------------------------------------------------

type StashListParams struct {
	RepoID string `json:"repoId"`
}

// StashListResult mirrors @kira/git-ipc's own `stash.list` result — `{entries: StashEntry[]}`.
type StashListResult struct {
	Entries []porcelain.StashEntry `json:"entries"`
}

// StashShowParams is stash.show's own request. G28 D17: Scope is optional — absent (or "stack")
// resolves against the ordinary stack (unchanged wire shape for every pre-G28 caller); "global"
// resolves against the bucket instead.
type StashShowParams struct {
	RepoID string `json:"repoId"`
	SHA    string `json:"sha"`
	Scope  string `json:"scope,omitempty"`
}

// PreflightStashPopParams is preflight.stashPop's own request. Index is accepted for wire-shape
// fidelity with the contract but not otherwise used by the Go orchestration below: PreflightStashPop
// re-resolves the entry fresh by sha (resolveStashEntryScoped, gitsession/stash.go) and reads its
// own CURRENT index off that fresh read — more correct than trusting a client-supplied index that
// may already be stale by the time this request lands, the same race the sha itself guards
// against. Scope: G28 D17, same optional "stack"/"global" shape as StashShowParams.
type PreflightStashPopParams struct {
	RepoID    string  `json:"repoId"`
	SHA       string  `json:"sha"`
	Index     int     `json:"index"`
	TargetSHA *string `json:"targetSha,omitempty"`
	Scope     string  `json:"scope,omitempty"`
}

// PreflightStashBranchParams is preflight.stashBranch's own request. Scope: G28 D17.
type PreflightStashBranchParams struct {
	RepoID string `json:"repoId"`
	SHA    string `json:"sha"`
	Branch string `json:"branch"`
	Scope  string `json:"scope,omitempty"`
}

// GlobalStashListParams is globalStash.list's own request (G28 D9/D17) — one new request, the
// bucket's own listing.
type GlobalStashListParams struct {
	RepoID string `json:"repoId"`
}

// ---------------------------------------------------------------------------------------
// P7 (G6) — branch review (D1, D18). review.resolveBase's own result is gitreview.BaseResolution
// (D5's own precedent applied again — no second, gitrpc-owned copy of a shape gitreview already
// produces JSON-tagged). CONTRACT_VERSION moves 14 -> 15 for this phase: review.resolveBase gains
// one optional param.
// ---------------------------------------------------------------------------------------

// ReviewResolveBaseParams is review.resolveBase's own request.
type ReviewResolveBaseParams struct {
	RepoID string  `json:"repoId"`
	Branch string  `json:"branch"`
	Base   *string `json:"base,omitempty"`
	// BaseCandidates (D1): optional, injected by the extension from kiraVersion.review.
	// baseCandidates. Absent for every raw socket client — the server defaults it
	// (gitreview.DefaultBaseCandidates).
	BaseCandidates []string `json:"baseCandidates,omitempty"`
}

// ---------------------------------------------------------------------------------------
// G7 — remote ops and the credential relay (D2). remote.pullPreflight/remote.pushPreflight's own
// results are gitpreflight's own wire-shaped types (PullPreflight/PushPreflight) — D5's own
// precedent applied again: no second, gitrpc-owned copy of a shape that package already produces
// JSON-tagged. CONTRACT_VERSION moves 15 -> 16 for exactly three additions: credential.request,
// credential.provide, and remote.pullPreflight's own optional strategySetting param.
// ---------------------------------------------------------------------------------------

// RemotePullPreflightParams is remote.pullPreflight's own request.
type RemotePullPreflightParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	// StrategySetting (D2): optional, injected by the extension from kiraVersion.pull.strategy,
	// exactly as review.resolveBase injects baseCandidates. Absent (or "auto") for every raw
	// socket client — gitpreflight.ResolvePullStrategy already treats "" as "auto".
	StrategySetting string `json:"strategySetting,omitempty"`
}

// RemotePushPreflightParams is remote.pushPreflight's own request.
type RemotePushPreflightParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	Remote string `json:"remote"`
}

// RemoteRunParams is remote.run's own request: RepoID plus gitsession's own flattened operation
// fields, embedded so JSON decode flattens them back out — remote.run's wire params are flat (no
// nested object, unlike op.run's own `op` key), the same shape OpRequest is for op.run (D5).
type RemoteRunParams struct {
	RepoID string `json:"repoId"`
	gitsession.RemoteOpParams
}

// RemoteCancelParams is remote.cancel's own request.
type RemoteCancelParams struct {
	RepoID string `json:"repoId"`
}

// RemoteCancelResult mirrors @kira/git-ipc's own remote.cancel result — `{cancelled: boolean}`,
// never an error (D19): a cancel racing a just-finished (or never-running, or non-killable) op is
// an ordinary outcome.
type RemoteCancelResult struct {
	Cancelled bool `json:"cancelled"`
}

// CredentialProvideParams is credential.provide's own request (D2/D4) — Secret is nil for a
// dismissal, never omitted (the `null`-vs-absent discipline G4 D5 set for this chapter: "dismissed"
// is a value the wire carries, not an absence the server has to infer).
type CredentialProvideParams struct {
	RequestID string  `json:"requestId"`
	Secret    *string `json:"secret"`
}

// ---------------------------------------------------------------------------------------
// G11 — incremental review: review.files/review.fileDiff/review.mark (D1, D13). Results are
// gitsession's own wire-shaped types (RangeFilesResult, ReviewFileDiffResult, ReviewFileStatus) —
// D5's own precedent applied again: no second, gitrpc-owned copy of a shape gitsession already
// produces JSON-tagged. CONTRACT_VERSION moves 17 -> 18 for exactly these three requests plus one
// new UiActionKind member (toggleFileReviewed, a webview-local control frame the Go server never
// sees, D1).
// ---------------------------------------------------------------------------------------

// ReviewFilesParams is review.files' own request — D5's session key: base is needed to compute the
// range's merge-base, but the session itself is keyed on (repoId, branch) alone (D5).
type ReviewFilesParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	Base   string `json:"base"`
}

// ReviewFileDiffParams is review.fileDiff's own request.
type ReviewFileDiffParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	Base   string `json:"base"`
	Path   string `json:"path"`
	Mode   string `json:"mode"` // "range" | "sinceReview"
}

// ReviewMarkParams is review.mark's own request — no base (D5: a write is a fact about
// (repo, branch, path) only). Ranges omitted (not merely empty) means "the whole file" (D13).
type ReviewMarkParams struct {
	RepoID   string                `json:"repoId"`
	Branch   string                `json:"branch"`
	Path     string                `json:"path"`
	Reviewed bool                  `json:"reviewed"`
	Ranges   []gitreview.LineRange `json:"ranges,omitempty"`
}

// ReviewMarkResult is review.mark's own result — the resulting status, so the file list updates
// from the response rather than re-requesting review.files after every checkbox (D13).
type ReviewMarkResult struct {
	Review gitsession.ReviewFileStatus `json:"review"`
}

// ---------------------------------------------------------------------------------------
// G13 — inline AI review comments (D1, D11). review.comment.list's own result is gitsession's own
// wire-shaped type (gitsession.CommentListResult) — D5's own precedent applied again. Every method
// runs validRefArg on branch, exactly like every other review.* method.
// ---------------------------------------------------------------------------------------

// ReviewCommentAddParams is review.comment.add's own request. `at` is required, with no default
// (D15): it is the revision the caller says it was reading, and there is no safe guess for it.
type ReviewCommentAddParams struct {
	RepoID string              `json:"repoId"`
	Branch string              `json:"branch"`
	Path   string              `json:"path"`
	At     string              `json:"at"`
	Range  gitreview.LineRange `json:"range"`
	Body   string              `json:"body"`
}

// ReviewCommentAddResult carries the whole new comment, id included, so the extension can render
// its thread from the response instead of re-listing (D11).
type ReviewCommentAddResult struct {
	Comment gitsession.CommentEntry `json:"comment"`
}

// ReviewCommentListParams is review.comment.list's own request — `at` optional, defaulting to the
// branch tip (D11).
type ReviewCommentListParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	At     string `json:"at,omitempty"`
}

// ReviewCommentRemoveParams is review.comment.remove's own request.
type ReviewCommentRemoveParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	ID     int64  `json:"id"`
}

// ReviewCommentRemoveResult is `false`, not an error, for a row already gone (D11) — two windows
// sharing one session is the designed state, not a client mistake.
type ReviewCommentRemoveResult struct {
	Removed bool `json:"removed"`
}

// ReviewCommentClearParams is review.comment.clear's own request.
type ReviewCommentClearParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
}

// ReviewCommentClearResult carries the removed count so the pane can announce it (D11).
type ReviewCommentClearResult struct {
	Removed int `json:"removed"`
}

// ReviewCommentExportParams is review.comment.export's own request — `at` optional, same default
// as list.
type ReviewCommentExportParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	At     string `json:"at,omitempty"`
}

// ReviewCommentExportResult's Text is "" for a session with no comments (D11) — never a header-only
// placeholder.
type ReviewCommentExportResult struct {
	At   string `json:"at"`
	Text string `json:"text"`
}

// ---------------------------------------------------------------------------------------
// G18 — repoSettings.get/set/changed (D3/D4). Wire-tagged with their literal kiraVersion.* dotted
// keys so RepoSettingsSnapshot is a direct structural copy of @kira/git-ipc's own
// RepoSettingsSnapshot, needing no translation layer on either side — the same discipline
// gitclient.GitStatus's own JSON tags already follow for GitStatus.
// ---------------------------------------------------------------------------------------

// RepoSettingsSnapshot is repoSettings.get/set's own result — the seven settings D1 moved into
// their own per-repo table. Six are genuinely scoped by repoId; kiraVersion.log.level is not
// (D14) — its value is shared across every repo this installation opens, a fact
// storage/repos.GitRepoSettingsRepo resolves entirely on its own, invisibly to this type and every
// handler using it.
type RepoSettingsSnapshot struct {
	GraphPageSize         int      `json:"kiraVersion.graph.pageSize"`
	GraphScope            string   `json:"kiraVersion.graph.scope"`
	StashShowInGraph      bool     `json:"kiraVersion.stash.showInGraph"`
	StashIncludeUntracked bool     `json:"kiraVersion.stash.includeUntracked"`
	ReviewBaseCandidates  []string `json:"kiraVersion.review.baseCandidates"`
	PullStrategy          string   `json:"kiraVersion.pull.strategy"`
	LogLevel              string   `json:"kiraVersion.log.level"`
	// GithubEnabled is G24 D16's own eighth leaf — genuinely per-repo (unlike LogLevel), default
	// true.
	GithubEnabled bool `json:"kiraVersion.github.enabled"`
	// WorktreePrepareScript/WorktreeBasePath are G25 D10/D16's own ninth and tenth leaves.
	WorktreePrepareScript string `json:"kiraVersion.worktree.prepareScript"`
	WorktreeBasePath      string `json:"kiraVersion.worktree.basePath"`
	// CheckoutAutoStash is G28 D16/D17's own eleventh leaf: read CLIENT-SIDE ONLY (the server never
	// consults it — the fail-safe direction, D16's own doc comment) to decide whether a blocked
	// checkout is re-issued with autoStash:true or falls through to the old CheckoutDialog. Default
	// true.
	CheckoutAutoStash bool `json:"kiraVersion.checkout.autoStash"`
}

// RepoSettingsGetParams is repoSettings.get's own request.
type RepoSettingsGetParams struct {
	RepoID string `json:"repoId"`
}

// RepoSettingsPatchWire mirrors RepoSettingsSnapshot's own `.partial()` shape — every leaf
// optional, present only when the caller means to change it (SettingsPatch/GitRepoSettingsPatch's
// own discipline, restated at the wire).
type RepoSettingsPatchWire struct {
	GraphPageSize         *int      `json:"kiraVersion.graph.pageSize,omitempty"`
	GraphScope            *string   `json:"kiraVersion.graph.scope,omitempty"`
	StashShowInGraph      *bool     `json:"kiraVersion.stash.showInGraph,omitempty"`
	StashIncludeUntracked *bool     `json:"kiraVersion.stash.includeUntracked,omitempty"`
	ReviewBaseCandidates  *[]string `json:"kiraVersion.review.baseCandidates,omitempty"`
	PullStrategy          *string   `json:"kiraVersion.pull.strategy,omitempty"`
	LogLevel              *string   `json:"kiraVersion.log.level,omitempty"`
	GithubEnabled         *bool     `json:"kiraVersion.github.enabled,omitempty"`
	WorktreePrepareScript *string   `json:"kiraVersion.worktree.prepareScript,omitempty"`
	WorktreeBasePath      *string   `json:"kiraVersion.worktree.basePath,omitempty"`
	CheckoutAutoStash     *bool     `json:"kiraVersion.checkout.autoStash,omitempty"`
}

// RepoSettingsSetParams is repoSettings.set's own request.
type RepoSettingsSetParams struct {
	RepoID string                `json:"repoId"`
	Patch  RepoSettingsPatchWire `json:"patch"`
}

// RepoSettingsChangedPayload is repoSettings.changed's own event payload (D4/D7) — emitted to
// every currently connected client, not only the one that made the change, via
// internal/notify.Emitter[T] (the same mechanism gitsock.Server's own clientsChanged already
// uses). RepoID names which repo's own write triggered the emit; a viewer decides for itself
// whether that repoId (or, for the instance-wide LogLevel, any repoId at all) is relevant.
type RepoSettingsChangedPayload struct {
	RepoID   string               `json:"repoId"`
	Settings RepoSettingsSnapshot `json:"settings"`
}

// SettingsSetGitPathParams is settings.setGitPath's own request (D11's own migration leg, D15) —
// extension-only, never called by the webview.
type SettingsSetGitPathParams struct {
	GitPath string `json:"gitPath"`
}

// ---------------------------------------------------------------------------------------
// G24 — commit.resolvePr / branch.resolvePr (D9/D14). GhStatus/PrRecord/PrLookupResult are direct
// structural copies of @kira/git-ipc's own types of the same name, kept honest by hand (this repo
// carries no wireConformance.test.ts — see this phase's own commit message) the same way
// gitclient.GitStatus's JSON tags already mirror GitStatus's TS twin.
// ---------------------------------------------------------------------------------------

// GhStatus mirrors ghclient.Status field for field — this phase's own D5 four-kind actionability
// union, crossing the wire unchanged.
type GhStatus struct {
	Kind    string `json:"kind"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Host    string `json:"host,omitempty"`
	Account string `json:"account,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func ghStatusFrom(s ghclient.Status) GhStatus {
	return GhStatus{Kind: s.Kind, Path: s.Path, Version: s.Version, Host: s.Host, Account: s.Account, Reason: s.Reason}
}

// PrRecord mirrors ghclient.PR field for field, camelCased at the wire.
type PrRecord struct {
	Number    int    `json:"number"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	State     string `json:"state"`
	HeadRef   string `json:"headRef"`
	HeadSha   string `json:"headSha"`
	BaseRef   string `json:"baseRef"`
	UpdatedAt int64  `json:"updatedAt"`
}

func prRecordFrom(p ghclient.PR) PrRecord {
	return PrRecord{
		Number: p.Number, Title: p.Title, URL: p.URL, State: p.State,
		HeadRef: p.HeadRef, HeadSha: p.HeadSha, BaseRef: p.BaseRef, UpdatedAt: p.UpdatedAt,
	}
}

// PrLookupResult mirrors @kira/git-ipc's own discriminated union (D14) — both commit.resolvePr and
// branch.resolvePr answer this exact shape.
type PrLookupResult struct {
	Kind string     `json:"kind"` // "ok" | "disabled" | "unavailable"
	PRs  []PrRecord `json:"prs,omitempty"`
	Gh   *GhStatus  `json:"gh,omitempty"`
}

func prLookupResultFrom(r gitsession.PrLookupResult) PrLookupResult {
	out := PrLookupResult{Kind: r.Kind}
	if r.Kind == "ok" {
		prs := make([]PrRecord, 0, len(r.PRs))
		for _, p := range r.PRs {
			prs = append(prs, prRecordFrom(p))
		}
		out.PRs = prs
	}
	if r.Gh != nil {
		gh := ghStatusFrom(*r.Gh)
		out.Gh = &gh
	}
	return out
}

// CommitResolvePrParams is commit.resolvePr's own request.
type CommitResolvePrParams struct {
	RepoID string `json:"repoId"`
	SHA    string `json:"sha"`
}

// BranchResolvePrParams is branch.resolvePr's own request.
type BranchResolvePrParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
}

// ---------------------------------------------------------------------------------------
// G25 — worktree support (D1-D14). worktree.list/preflight.worktreeAdd/preflight.worktreeRemove's
// own results are gitsession's/gitpreflight's own wire-shaped types ([]gitsession.WorktreeEntry
// wrapped in WorktreeListResult, gitpreflight.WorktreeAddPreflight, gitpreflight.
// WorktreeRemovePreflight) — D5's own precedent applied again: no second, gitrpc-owned copy of a
// shape those packages already produce JSON-tagged. worktree.prepare's own result is
// gitsession.WorktreePrepareResult, same precedent. CONTRACT_VERSION moves 27 -> 28 (D16).
// ---------------------------------------------------------------------------------------

// WorktreeListParams is worktree.list's own request.
type WorktreeListParams struct {
	RepoID string `json:"repoId"`
}

// WorktreeListResult mirrors @kira/git-ipc's own worktree.list result — `{worktrees:
// WorktreeEntry[]}`.
type WorktreeListResult struct {
	Worktrees []gitsession.WorktreeEntry `json:"worktrees"`
}

// PreflightWorktreeAddParams is preflight.worktreeAdd's own request (D2/D4).
type PreflightWorktreeAddParams struct {
	RepoID     string `json:"repoId"`
	Path       string `json:"path"`
	Mode       string `json:"mode"` // "existingBranch" | "newBranch" | "detach"
	Branch     string `json:"branch,omitempty"`
	StartPoint string `json:"startPoint,omitempty"`
}

// PreflightWorktreeRemoveParams is preflight.worktreeRemove's own request (D8).
type PreflightWorktreeRemoveParams struct {
	RepoID string `json:"repoId"`
	Path   string `json:"path"`
}

// WorktreePrepareParams is worktree.prepare's own request (D13) — ScriptSha256 is the client's own
// belief about which script text it is approving; the server always re-hashes the CURRENTLY STORED
// text and refuses with ScriptChanged on any mismatch before spawning anything (D11).
type WorktreePrepareParams struct {
	RepoID       string `json:"repoId"`
	Path         string `json:"path"`
	ScriptSha256 string `json:"scriptSha256"`
}

// WorktreeCancelPrepareParams is worktree.cancelPrepare's own request.
type WorktreeCancelPrepareParams struct {
	RepoID string `json:"repoId"`
}

// WorktreeCancelPrepareResult mirrors @kira/git-ipc's own worktree.cancelPrepare result —
// `{cancelled: boolean}`, never an error (D13/RemoteCancelResult's own precedent): a cancel racing
// a just-finished or never-running prepare is an ordinary outcome, not a fault.
type WorktreeCancelPrepareResult struct {
	Cancelled bool `json:"cancelled"`
}

// StackListParams is stack.list's own request (G26 D3) — the RESULT is
// gitsession.RepoEntry.Stacks' own gitpreflight.StackListResult, returned directly with no wrapper,
// the same "handler returns the gitpreflight/gitsession struct as-is" convention
// preflight.worktreeAdd/preflight.worktreeRemove already established.
type StackListParams struct {
	RepoID string `json:"repoId"`
}

// PreflightRestackParams is preflight.restack's own request (D14) — the RESULT is
// gitpreflight.RestackPreflight, returned directly.
type PreflightRestackParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
}

// StackRestackParams is stack.restack's own request (D6) — the RESULT is
// gitsession.RestackResult, returned directly.
type StackRestackParams struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
}

// StackCancelRestackParams is stack.cancelRestack's own request (D9).
type StackCancelRestackParams struct {
	RepoID string `json:"repoId"`
}

// StackCancelRestackResult mirrors @kira/git-ipc's own stack.cancelRestack result —
// `{cancelled: boolean}`, never an error (D9/RemoteCancelResult's own precedent): a cancel racing a
// just-finished or never-running restack is an ordinary outcome, not a fault.
type StackCancelRestackResult struct {
	Cancelled bool `json:"cancelled"`
}
