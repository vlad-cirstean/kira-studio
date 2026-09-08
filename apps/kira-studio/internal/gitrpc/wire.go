package gitrpc

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
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
