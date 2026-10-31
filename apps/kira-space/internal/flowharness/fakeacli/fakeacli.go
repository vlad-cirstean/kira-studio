// Package fakeacli is an in-process stand-in for the Atlassian CLI in flow tests. It is both the
// jira.Locator and the jira.Runner, so no process spawns and the host's real acli is never reached.
package fakeacli

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// Acli answers acli by argv from a scripted state. Every call is recorded.
type Acli struct {
	mu        sync.Mutex
	installed bool
	loggedIn  bool
	site      string
	issues    map[string]string
	gate      chan struct{}
	calls     []string
}

// New returns an installed, logged-in acli for site with no issues.
func New(site string) *Acli {
	return &Acli{installed: true, loggedIn: true, site: site, issues: map[string]string{}}
}

// SetInstalled makes the binary present or absent.
func (a *Acli) SetInstalled(v bool) { a.mu.Lock(); a.installed = v; a.mu.Unlock() }

// SetLoggedIn signs the CLI in or out.
func (a *Acli) SetLoggedIn(v bool) { a.mu.Lock(); a.loggedIn = v; a.mu.Unlock() }

// SetIssue serves raw as the JSON of workitem view KEY.
func (a *Acli) SetIssue(key, raw string) { a.mu.Lock(); a.issues[key] = raw; a.mu.Unlock() }

// Hold blocks every workitem view until the returned release func is called or the caller gives up.
func (a *Acli) Hold() (release func()) {
	gate := make(chan struct{})
	a.mu.Lock()
	a.gate = gate
	a.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { close(gate) }) }
}

// Calls returns every recorded call, in order: "version", "auth", or "view:<KEY>".
func (a *Acli) Calls() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.calls)
}

// Count returns how many recorded calls start with prefix.
func (a *Acli) Count(prefix string) int {
	n := 0
	for _, c := range a.Calls() {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

// Locate implements jira.Locator.
func (a *Acli) Locate() (string, []string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.installed {
		return "", []string{"acli (on PATH)", "/opt/homebrew/bin/acli", "/usr/local/bin/acli"}, false
	}
	return "/fake/bin/acli", []string{"/fake/bin/acli"}, true
}

// Run implements jira.Runner.
func (a *Acli) Run(ctx context.Context, _ string, args []string) ([]byte, error) {
	a.mu.Lock()
	loggedIn, site, gate := a.loggedIn, a.site, a.gate
	a.mu.Unlock()
	switch {
	case len(args) == 1 && args[0] == "--version":
		a.record("version")
		return []byte("acli version 1.3.4-stable\n"), nil
	case slices.Equal(args, []string{"jira", "auth", "status"}):
		a.record("auth")
		if !loggedIn {
			return nil, &toolexec.ExecError{ExitCode: 1, Stderr: "no Jira account is logged in"}
		}
		return []byte(fmt.Sprintf("Authenticated\n  Site: %s\n  Email: me@acme.test\n", site)), nil
	case len(args) >= 4 && slices.Equal(args[:3], []string{"jira", "workitem", "view"}):
		key := args[3]
		a.record("view:" + key)
		if gate != nil {
			select {
			case <-gate:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		a.mu.Lock()
		raw, ok := a.issues[key]
		a.mu.Unlock()
		if !ok {
			return nil, &toolexec.ExecError{ExitCode: 1, Stderr: "Error: issue does not exist or you do not have permission to see it"}
		}
		return []byte(raw), nil
	}
	return nil, &toolexec.ExecError{ExitCode: 2, Stderr: "fakeacli: unsupported: " + strings.Join(args, " ")}
}

func (a *Acli) record(call string) {
	a.mu.Lock()
	a.calls = append(a.calls, call)
	a.mu.Unlock()
}

// IssueJSON is the workitem view JSON of an issue with a Development field of prs pull requests, in the
// string form Jira serves it.
func IssueJSON(key, title, status, category string, prs int) string {
	dev := fmt.Sprintf(`{pullrequest={dataType=pullrequest, state=OPEN, stateCount=%d}, json={"cachedValue":{"errors":[],"summary":{"pullrequest":{"overall":{"count":%d,"state":"OPEN","dataType":"pullrequest","open":true},"byInstanceType":{"GitHub":{"count":%d,"name":"GitHub"}}}}},"isStale":false}}`, prs, prs, prs)
	b, err := json.Marshal(map[string]any{"key": key, "fields": map[string]any{
		"summary": title, "status": map[string]any{"name": status, "statusCategory": map[string]any{"key": category}},
		"customfield_10000": dev,
	}})
	if err != nil {
		panic(err)
	}
	return string(b)
}
