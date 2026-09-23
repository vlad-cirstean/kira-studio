package gitaskpass

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

// helperFallbackTimeout is used only when KIRA_ASKPASS_TIMEOUT_MS is missing or unparseable — a
// broker that set it correctly always wins; this is a fail-closed floor, not the normal path.
const helperFallbackTimeout = DefaultTimeout

// RunHelper is the askpass helper's whole client half (D8) — main.go's askpass subcommand
// dispatches straight to this before anything Wails-related runs. Fail closed throughout: any
// missing env, any malformed response, any deadline exceeded is exit 1 and prints nothing —
// probe P2's own finding is that git treats a non-zero askpass exit as immediately fatal, with no
// retry, which is what turns every one of this function's failure paths into "the op fails
// promptly" rather than a hang. Never writes the prompt or the answer anywhere but stdout, and
// only the answer, only on success.
func RunHelper(args []string, env []string, stdout io.Writer) int {
	// F19: OpenSSH sets SSH_ASKPASS_PROMPT for two variants this helper otherwise mishandled by
	// treating both as an ordinary masked text prompt, leaving a stale, meaningless prompt on
	// screen — "none" for a FIDO/security-key touch notification (no text answer is ever
	// expected; OpenSSH kills the helper itself once the touch happens or times out) and
	// "confirm" for a yes/no question (e.g. "Allow user@host to reset the passphrase?").
	switch lookupEnvOr(env, "SSH_ASKPASS_PROMPT", "") {
	case "none":
		// Nothing to prompt for at all — exit 0 without contacting the broker.
		return 0
	case "confirm":
		if len(args) < 1 {
			return 1
		}
		resp, ok := exchange(env, args[0], true)
		if !ok || !resp.OK {
			return 1
		}
		// A confirm prompt's own answer text is never printed — SSH_ASKPASS's own contract for
		// this variant is exit code only (0 = confirmed, 1 = declined/not answered).
		return 0
	}

	if len(args) < 1 {
		return 1
	}
	resp, ok := exchange(env, args[0], false)
	if !ok || !resp.OK {
		return 1
	}
	if _, err := fmt.Fprintln(stdout, resp.Answer); err != nil {
		return 1
	}
	return 0
}

// exchange is RunHelper's whole client half of D8's one-round-trip protocol: dial the broker's
// private socket, send prompt (Confirm as given, F19), and read back its answer. ok is false for
// ANY transport-level failure (missing env, dial/write/read error, malformed JSON) — indistinguishable
// from a declined prompt to the caller, which is exactly RunHelper's own fail-closed contract.
func exchange(env []string, prompt string, confirm bool) (resp socketResponse, ok bool) {
	sockPath, has := lookupEnv(env, "KIRA_ASKPASS_SOCK")
	if !has || sockPath == "" {
		return socketResponse{}, false
	}
	token, has := lookupEnv(env, "KIRA_ASKPASS_TOKEN")
	if !has || token == "" {
		return socketResponse{}, false
	}
	opID, has := lookupEnv(env, "KIRA_ASKPASS_OPID")
	if !has || opID == "" {
		return socketResponse{}, false
	}

	timeout := helperFallbackTimeout
	if raw, has := lookupEnv(env, "KIRA_ASKPASS_TIMEOUT_MS"); has {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil && ms > 0 {
			timeout = time.Duration(ms) * time.Millisecond
		}
	}
	deadline := time.Now().Add(timeout)

	dialer := net.Dialer{Deadline: deadline}
	conn, err := dialer.Dial("unix", sockPath)
	if err != nil {
		return socketResponse{}, false
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline); err != nil {
		return socketResponse{}, false
	}

	reqBytes, err := json.Marshal(socketRequest{Token: token, OpID: opID, Prompt: prompt, Confirm: confirm})
	if err != nil {
		return socketResponse{}, false
	}
	reqBytes = append(reqBytes, '\n')
	if _, err := conn.Write(reqBytes); err != nil {
		return socketResponse{}, false
	}

	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return socketResponse{}, false
	}
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		return socketResponse{}, false
	}
	return resp, true
}

// lookupEnv reads key out of an env slice shaped like os.Environ() — the last match wins, mirroring
// how a real process environment shadows an earlier entry with a later one.
func lookupEnv(env []string, key string) (string, bool) {
	prefix := key + "="
	value, found := "", false
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, prefix); ok {
			value, found = v, true
		}
	}
	return value, found
}

// lookupEnvOr is lookupEnv with a default for the not-present case — SSH_ASKPASS_PROMPT is legitimately
// absent for the ordinary (non-FIDO, non-confirm) prompt case, which is not a failure the way a
// missing KIRA_ASKPASS_* variable is.
func lookupEnvOr(env []string, key, fallback string) string {
	if v, ok := lookupEnv(env, key); ok {
		return v
	}
	return fallback
}
