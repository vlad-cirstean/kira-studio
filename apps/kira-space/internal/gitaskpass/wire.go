package gitaskpass

// socketRequest/socketResponse are the whole protocol (D8) — one NUL-free JSON line each way over
// the broker's own private unix socket. Never logged: neither carries anything but a token, an
// opaque op id and git's own prompt text / the user's own answer, and this package's own rule
// (D9) is that none of those three is ever written to a file, a log line or a database.
type socketRequest struct {
	Token  string `json:"token"`
	OpID   string `json:"opId"`
	Prompt string `json:"prompt"`
	// Confirm (F19) is true for a yes/no confirmation prompt (OpenSSH's own
	// SSH_ASKPASS_PROMPT=confirm) rather than an ordinary masked/unmasked text prompt — the
	// relayed UI should show Yes/No, not a text field, and the helper never prints Answer for
	// one of these; only OK (confirmed or not) matters.
	Confirm bool `json:"confirm,omitempty"`
}

type socketResponse struct {
	OK bool `json:"ok"`
	// Answer is present only when OK is true — an unanswered request never puts anything here, and
	// the helper never inspects Answer unless OK is true either.
	Answer string `json:"answer,omitempty"`
}
