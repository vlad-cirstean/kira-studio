package gitrpc

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"

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

// CommitRangeParams is CommitRange's wire shape — carried only so a `range` request can be
// recognised and refused (D14: a ranged walk is G6's, not half-served here).
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
