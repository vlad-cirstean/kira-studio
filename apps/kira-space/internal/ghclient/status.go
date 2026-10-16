package ghclient

// Status is D1/D5's own four-kind actionability union — SPEC §3.5's own gloss
// ("ok" | "notFound" | "unauthenticated" | "forbidden") widened, per D5, to carry the real six-shape
// failure surface (F15) as Reason detail rather than as a fifth/sixth Kind: the badge/search/reaper
// callers above this package only ever need to know WHICH of these four classes they got, never the
// underlying HTTP status or gh exit code — that stays inside errors.go's own classify.
type Status struct {
	Kind string `json:"kind"` // "ok" | "notFound" | "unauthenticated" | "forbidden"
	// Path is the resolved `gh` binary's path — set only for "ok" (mirrors gitclient.GitStatus's
	// own Path field, present only on its own "ok"/"unusable" kinds).
	Path string `json:"path,omitempty"`
	// Version is `gh --version`'s own reported version string, set only for "ok".
	Version string `json:"version,omitempty"`
	// Host is the GitHub host this Status was probed against ("github.com", or a GHES hostname) —
	// set whenever probing got far enough to know which host it was checking.
	Host string `json:"host,omitempty"`
	// Account is `gh auth status`'s own logged-in account name, set only for "ok" when `gh` reports
	// one — informational only, never used to gate anything.
	Account string `json:"account,omitempty"`
	// Probed lists every candidate path considered, in probe order — set only for "notFound",
	// mirroring gitclient.GitStatus's own Probed field.
	Probed []string `json:"probed,omitempty"`
	// Reason is D5's own human-readable detail — the one place a specific HTTP status or gh exit
	// code becomes user-facing text (D12: the commit-detail pane is the only surface that ever
	// shows it). Empty for "ok".
	Reason string `json:"reason,omitempty"`
}

// OK reports whether s represents a successful probe/call.
func (s Status) OK() bool { return s.Kind == "ok" }

const (
	KindOK              = "ok"
	KindNotFound        = "notFound"
	KindUnauthenticated = "unauthenticated"
	KindForbidden       = "forbidden"
)
