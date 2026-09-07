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
