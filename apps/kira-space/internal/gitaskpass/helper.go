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
	sockPath, ok := lookupEnv(env, "KIRA_ASKPASS_SOCK")
	if !ok || sockPath == "" {
		return 1
	}
	token, ok := lookupEnv(env, "KIRA_ASKPASS_TOKEN")
	if !ok || token == "" {
		return 1
	}
	opID, ok := lookupEnv(env, "KIRA_ASKPASS_OPID")
	if !ok || opID == "" {
		return 1
	}
	if len(args) < 1 {
		return 1
	}
	prompt := args[0]

	timeout := helperFallbackTimeout
	if raw, ok := lookupEnv(env, "KIRA_ASKPASS_TIMEOUT_MS"); ok {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil && ms > 0 {
			timeout = time.Duration(ms) * time.Millisecond
		}
	}
	deadline := time.Now().Add(timeout)

	dialer := net.Dialer{Deadline: deadline}
	conn, err := dialer.Dial("unix", sockPath)
	if err != nil {
		return 1
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline); err != nil {
		return 1
	}

	reqBytes, err := json.Marshal(socketRequest{Token: token, OpID: opID, Prompt: prompt})
	if err != nil {
		return 1
	}
	reqBytes = append(reqBytes, '\n')
	if _, err := conn.Write(reqBytes); err != nil {
		return 1
	}

	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return 1
	}
	var resp socketResponse
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		return 1
	}
	if !resp.OK {
		return 1
	}
	if _, err := fmt.Fprintln(stdout, resp.Answer); err != nil {
		return 1
	}
	return 0
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
