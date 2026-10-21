// Package fakehost is an in-process second code host for flow tests. It speaks "merge requests" on
// forge.test, so a test proves nothing in the app hard-codes GitHub's words, URLs or CLI.
package fakehost

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// ID is the setting value and registry key of the fake host.
const ID = "forge"

// Host is the one host name the fake claims.
const Host = "forge.test"

// Forge is a githost.Provider and githost.FileReviewSync over in-memory data. Every call is recorded.
type Forge struct {
	mu     sync.Mutex
	crs    []githost.ChangeRequest
	files  map[int][]string
	viewed map[string]bool
	calls  []string
}

var (
	_ githost.Provider       = (*Forge)(nil)
	_ githost.FileReviewSync = (*Forge)(nil)
)

// New returns an empty fake host.
func New() *Forge { return &Forge{files: map[int][]string{}, viewed: map[string]bool{}} }

// WithoutSync hides p's FileReviewSync, to exercise a host with no per-file viewed state.
func WithoutSync(p githost.Provider) githost.Provider { return plain{p} }

type plain struct{ githost.Provider }

// AddChangeRequest registers cr. Set HeadOwner to the repo owner for the branch to badge.
func (f *Forge) AddChangeRequest(cr githost.ChangeRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.crs = append(f.crs, cr)
}

// SetHead moves merge request number's head, as a push to its branch would.
func (f *Forge) SetHead(number int, sha string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.crs {
		if f.crs[i].Number == number {
			f.crs[i].HeadSha = sha
		}
	}
}

// SetFiles sets the changed files of merge request number.
func (f *Forge) SetFiles(number int, paths ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[number] = paths
}

// Viewed reports whether path is marked viewed on merge request number.
func (f *Forge) Viewed(number int, path string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.viewed[viewKey(number, path)]
}

// Calls returns every recorded call, in order, as "Method" or "Method:arg".
func (f *Forge) Calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.calls)
}

// Count returns how many recorded calls start with prefix.
func (f *Forge) Count(prefix string) int {
	n := 0
	for _, c := range f.Calls() {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func (f *Forge) record(call string) {
	f.mu.Lock()
	f.calls = append(f.calls, call)
	f.mu.Unlock()
}

func viewKey(number int, path string) string { return fmt.Sprintf("%d:%s", number, path) }

func (f *Forge) ID() string { return ID }

func (f *Forge) Terms() githost.Terms {
	return githost.Terms{
		Label: "Forge", ChangeRequest: "Merge request", ChangeRequestNoun: "merge request",
		ChangeRequestShort: "MR", CLI: "Forge CLI",
	}
}

var remotePattern = regexp.MustCompile(`^(?:https://|git@)forge\.test[/:]([^/\s]+)/([^/\s]+?)(?:\.git)?/?$`)

func (f *Forge) ParseRemote(remoteURL string) (githost.Repo, bool) {
	m := remotePattern.FindStringSubmatch(strings.TrimSpace(remoteURL))
	if m == nil {
		return githost.Repo{}, false
	}
	return githost.Repo{Host: Host, Owner: m[1], Name: m[2]}, true
}

func (f *Forge) Claims(_ context.Context, host string) bool { return host == Host }

func (f *Forge) Status(context.Context, string) githost.Status {
	return githost.Status{Kind: githost.KindOK, Host: Host, Account: "forger"}
}

func (f *Forge) Account(context.Context, string) string { return "forger" }

func (f *Forge) ForCommit(_ context.Context, _ githost.Repo, sha string) ([]githost.ChangeRequest, githost.Status) {
	f.record("ForCommit:" + sha)
	return f.match(func(cr githost.ChangeRequest) bool { return cr.HeadSha == sha })
}

func (f *Forge) ForBranch(_ context.Context, _ githost.Repo, branch string) ([]githost.ChangeRequest, githost.Status) {
	f.record("ForBranch:" + branch)
	return f.match(func(cr githost.ChangeRequest) bool { return cr.HeadRef == branch })
}

func (f *Forge) Open(_ context.Context, _ githost.Repo) ([]githost.ChangeRequest, githost.Status) {
	f.record("Open")
	return f.match(func(cr githost.ChangeRequest) bool { return cr.State == "open" || cr.State == "draft" })
}

func (f *Forge) match(keep func(githost.ChangeRequest) bool) ([]githost.ChangeRequest, githost.Status) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []githost.ChangeRequest
	for _, cr := range f.crs {
		if keep(cr) {
			out = append(out, cr)
		}
	}
	return out, githost.Status{Kind: githost.KindOK, Host: Host}
}

func (f *Forge) ChangeRequestURL(r githost.Repo, number int) string {
	return fmt.Sprintf("%s/-/merge_requests/%d", f.RepoURL(r), number)
}

func (f *Forge) RepoURL(r githost.Repo) string {
	return fmt.Sprintf("https://%s/%s/%s", r.Host, r.Owner, r.Name)
}

func (f *Forge) BranchURL(r githost.Repo, branch string) string {
	return f.RepoURL(r) + "/-/tree/" + githost.RefPath(branch)
}

var mergeRequestPath = regexp.MustCompile(`^/[\w.-]+/[\w.-]+/-/merge_requests/[0-9]+$`)

func (f *Forge) IsChangeRequestURL(_ context.Context, u *url.URL) bool {
	return u.Scheme == "https" && u.Host == Host && mergeRequestPath.MatchString(u.Path)
}

var linkPattern = regexp.MustCompile(`^https://forge\.test/[^/\s]+/([^/\s]+)/-/(issues|merge_requests)/(\d+)`)

func (f *Forge) ParseLink(raw string) (githost.Link, bool) {
	m := linkPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return githost.Link{}, false
	}
	if m[2] == "merge_requests" {
		return githost.Link{Provider: ID, Kind: githost.LinkChangeRequest, Ref: m[1] + "!" + m[3]}, true
	}
	return githost.Link{Provider: ID, Kind: githost.LinkIssue, Ref: m[1] + "#" + m[3]}, true
}

func (f *Forge) ChangeFiles(_ context.Context, _ githost.Repo, number int) (githost.ChangeFiles, githost.Status) {
	f.record(fmt.Sprintf("ChangeFiles:%d", number))
	f.mu.Lock()
	defer f.mu.Unlock()
	out := githost.ChangeFiles{NodeID: fmt.Sprintf("MR_%d", number)}
	for _, cr := range f.crs {
		if cr.Number == number {
			out.HeadSha, out.Open = cr.HeadSha, cr.State == "open" || cr.State == "draft"
		}
	}
	for _, p := range f.files[number] {
		out.Files = append(out.Files, githost.ChangedFile{Path: p, Viewed: f.viewed[viewKey(number, p)]})
	}
	return out, githost.Status{Kind: githost.KindOK, Host: Host, Account: "forger"}
}

func (f *Forge) SetFilesViewed(_ context.Context, _ githost.Repo, nodeID string, paths []string, viewed bool) (map[string]string, githost.Status) {
	var number int
	if _, err := fmt.Sscanf(nodeID, "MR_%d", &number); err != nil {
		return nil, githost.Status{Kind: githost.KindNotFound, Reason: "unknown node " + nodeID}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range paths {
		f.calls = append(f.calls, fmt.Sprintf("SetFilesViewed:%d:%s:%t", number, p, viewed))
		f.viewed[viewKey(number, p)] = viewed
	}
	return nil, githost.Status{Kind: githost.KindOK, Host: Host}
}
