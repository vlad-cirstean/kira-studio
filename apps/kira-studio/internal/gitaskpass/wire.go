package gitaskpass

// socketRequest/socketResponse are the whole protocol (D8) — one NUL-free JSON line each way over
// the broker's own private unix socket. Never logged: neither carries anything but a token, an
// opaque op id and git's own prompt text / the user's own answer, and this package's own rule
// (D9) is that none of those three is ever written to a file, a log line or a database.
type socketRequest struct {
	Token  string `json:"token"`
	OpID   string `json:"opId"`
	Prompt string `json:"prompt"`
}

type socketResponse struct {
	OK bool `json:"ok"`
	// Answer is present only when OK is true — an unanswered request never puts anything here, and
	// the helper never inspects Answer unless OK is true either.
	Answer string `json:"answer,omitempty"`
}
