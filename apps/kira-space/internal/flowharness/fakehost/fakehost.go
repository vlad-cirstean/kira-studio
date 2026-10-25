// Package fakehost is an in-process second code host for flow tests. It speaks "merge requests" on
// forge.test, so a test proves nothing in the app hard-codes GitHub's words, URLs or CLI.
package fakehost

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// ID is the setting value and registry key of the fake host.
const ID = "forge"

// Host is the one host name the fake claims.
const Host = "forge.test"

// Forge is a githost.Provider, githost.FileReviewSync and githost.ChangeRequestSync over in-memory
// data. Every call is recorded.
type Forge struct {
	mu     sync.Mutex
	crs    []githost.ChangeRequest
	files  map[int][]string
	viewed map[string]bool
	calls  []string
	// rev changes whenever the listing a Probe sees changes: every mutation but a checks state.
	rev     int
	account string
	limited time.Time
}

var (
	_ githost.Provider          = (*Forge)(nil)
	_ githost.FileReviewSync    = (*Forge)(nil)
	_ githost.ChangeRequestSync = (*Forge)(nil)
)

// New returns an empty fake host.
func New() *Forge {
	return &Forge{files: map[int][]string{}, viewed: map[string]bool{}, account: "forger"}
}

// WithoutSync hides p's FileReviewSync, to exercise a host with no per-file viewed state.
func WithoutSync(p githost.Provider) githost.Provider { return plain{p} }

type plain struct{ githost.Provider }

// AddChangeRequest registers cr. Set HeadOwner to the repo owner for the branch to badge.
func (f *Forge) AddChangeRequest(cr githost.ChangeRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.crs = append(f.crs, cr)
	f.rev++
}

// SetChangeRequest adds cr, or replaces the one with its number, as an update on the host does.
func (f *Forge) SetChangeRequest(cr githost.ChangeRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rev++
	for i := range f.crs {
		if f.crs[i].Number == cr.Number {
			f.crs[i] = cr
			return
		}
	}
	f.crs = append(f.crs, cr)
}

// RemoveChangeRequest deletes merge request number from the host.
func (f *Forge) RemoveChangeRequest(number int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rev++
	f.crs = slices.DeleteFunc(f.crs, func(cr githost.ChangeRequest) bool { return cr.Number == number })
}

// SetChecksState sets the CI state of merge request number. Like a real CI result, it does not
// change the host's listing, so a Probe still answers unchanged.
func (f *Forge) SetChecksState(number int, state string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.crs {
		if f.crs[i].Number == number {
			f.crs[i].ChecksState = state
		}
	}
}

// SetAccount changes the signed-in account name.
func (f *Forge) SetAccount(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.account = name
}

// SetRateLimited makes every host call fail as rate limited until until; the zero time clears it.
func (f *Forge) SetRateLimited(until time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.limited = until
}

// SetHead moves merge request number's head, as a push to its branch would.
func (f *Forge) SetHead(number int, sha string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.crs {
		if f.crs[i].Number == number {
			f.crs[i].HeadSha = sha
			f.rev++
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
	return githost.Status{Kind: githost.KindOK, Host: Host, Account: f.accountName()}
}

func (f *Forge) Account(context.Context, string) string { return f.accountName() }

func (f *Forge) accountName() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.account
}

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

// rateLimit is the failed status of a call made while SetRateLimited is in force.
func (f *Forge) rateLimit() (githost.Status, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.limited.IsZero() || !time.Now().Before(f.limited) {
		return githost.Status{}, false
	}
	return githost.Status{Kind: githost.KindForbidden, Host: Host, Reason: "rate limit exhausted", RateLimited: true, ResetAt: f.limited}, true
}

func nodeID(number int) string { return fmt.Sprintf("MR_%d", number) }

// withSyncFields fills the fields a sync read carries.
func withSyncFields(cr githost.ChangeRequest) githost.ChangeRequest {
	cr.NodeID = nodeID(cr.Number)
	cr.Draft = cr.State == "draft"
	return cr
}

func (f *Forge) Page(_ context.Context, _ githost.Repo, cursor string, first int) (githost.ChangeRequestPage, githost.Status) {
	f.record("Page:" + cursor)
	if st, limited := f.rateLimit(); limited {
		return githost.ChangeRequestPage{}, st
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	sorted := slices.Clone(f.crs)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].UpdatedAt != sorted[j].UpdatedAt {
			return sorted[i].UpdatedAt > sorted[j].UpdatedAt
		}
		return sorted[i].Number > sorted[j].Number
	})
	start, _ := strconv.Atoi(cursor)
	start = min(max(start, 0), len(sorted))
	end := min(start+max(first, 1), len(sorted))
	page := githost.ChangeRequestPage{EndCursor: strconv.Itoa(end), HasNext: end < len(sorted)}
	for _, cr := range sorted[start:end] {
		page.Items = append(page.Items, withSyncFields(cr))
	}
	return page, githost.Status{Kind: githost.KindOK, Host: Host}
}

func (f *Forge) Probe(_ context.Context, _ githost.Repo, etag string) (bool, string, githost.Status) {
	if st, limited := f.rateLimit(); limited {
		f.record("Probe:limited")
		return false, "", st
	}
	f.mu.Lock()
	current := "r" + strconv.Itoa(f.rev)
	f.mu.Unlock()
	if etag == current {
		f.record("Probe:304")
		return false, current, githost.Status{Kind: githost.KindOK, Host: Host}
	}
	f.record("Probe:200")
	return true, current, githost.Status{Kind: githost.KindOK, Host: Host}
}

func (f *Forge) Checks(_ context.Context, _ githost.Repo, nodeIDs []string) ([]githost.ChangeRequest, githost.Status) {
	f.record("Checks:" + strconv.Itoa(len(nodeIDs)))
	if st, limited := f.rateLimit(); limited {
		return nil, st
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []githost.ChangeRequest
	for _, cr := range f.crs {
		if slices.Contains(nodeIDs, nodeID(cr.Number)) {
			out = append(out, withSyncFields(cr))
		}
	}
	return out, githost.Status{Kind: githost.KindOK, Host: Host}
}
