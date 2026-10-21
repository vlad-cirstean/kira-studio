package github

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// ProviderID is the setting value and registry key of this provider.
const ProviderID = "github"

// Options are the `gh` seams; a nil field takes the real one.
type Options struct {
	Locator Locator
	Runner  Runner
	Clock   Clock
}

// Provider adapts Client to the githost roles.
type Provider struct{ client *Client }

var (
	_ githost.Provider       = (*Provider)(nil)
	_ githost.FileReviewSync = (*Provider)(nil)
)

// New builds the GitHub provider over the `gh` CLI.
func New(o Options) *Provider {
	if o.Locator == nil {
		o.Locator = NewPlatformLocator()
	}
	if o.Runner == nil {
		o.Runner = NewExecRunner()
	}
	if o.Clock == nil {
		o.Clock = NewRealClock()
	}
	return &Provider{client: NewClient(NewDiscovery(o.Locator, o.Runner, o.Clock), o.Runner)}
}

func (p *Provider) ID() string { return ProviderID }

func (p *Provider) Terms() githost.Terms {
	return githost.Terms{
		Label: "GitHub", ChangeRequest: "Pull request", ChangeRequestNoun: "pull request",
		ChangeRequestShort: "PR", CLI: "GitHub CLI (gh)",
	}
}

func (p *Provider) ParseRemote(remoteURL string) (githost.Repo, bool) {
	r, ok := ParseRemote(remoteURL)
	return githost.Repo(r), ok
}

// Claims is github.com, or a host `gh` has authenticated against (GitHub Enterprise Server).
func (p *Provider) Claims(ctx context.Context, host string) bool {
	if host == "github.com" {
		return true
	}
	for _, h := range p.client.Hosts(ctx) {
		if strings.EqualFold(h, host) {
			return true
		}
	}
	return false
}

func (p *Provider) Status(ctx context.Context, host string) githost.Status {
	return toStatus(p.client.discovery.Status(ctx, host))
}

func (p *Provider) Account(ctx context.Context, host string) string {
	return p.client.Account(ctx, host)
}

func (p *Provider) ForCommit(ctx context.Context, r githost.Repo, sha string) ([]githost.ChangeRequest, githost.Status) {
	prs, s := p.client.PullsForCommit(ctx, Repo(r), sha)
	return toChangeRequests(prs), toStatus(s)
}

func (p *Provider) ForBranch(ctx context.Context, r githost.Repo, branch string) ([]githost.ChangeRequest, githost.Status) {
	prs, s := p.client.PullsForBranch(ctx, Repo(r), branch)
	return toChangeRequests(prs), toStatus(s)
}

func (p *Provider) Open(ctx context.Context, r githost.Repo) ([]githost.ChangeRequest, githost.Status) {
	prs, s := p.client.OpenPulls(ctx, Repo(r))
	return toChangeRequests(prs), toStatus(s)
}

func (p *Provider) ChangeRequestURL(r githost.Repo, number int) string {
	return fmt.Sprintf("https://%s/%s/pull/%d", r.Host, Repo(r).Path(), number)
}

func (p *Provider) RepoURL(r githost.Repo) string {
	return fmt.Sprintf("https://%s/%s", r.Host, Repo(r).Path())
}

func (p *Provider) BranchURL(r githost.Repo, branch string) string {
	return p.RepoURL(r) + "/tree/" + branch
}

// pullRequestPath matches /{owner}/{repo}/pull/{number}, owner and repo restricted to the characters
// GitHub allows in a login or repo name.
var pullRequestPath = regexp.MustCompile(`^/[\w.-]+/[\w.-]+/pull/[0-9]+$`)

func (p *Provider) IsChangeRequestURL(ctx context.Context, u *url.URL) bool {
	return u.Scheme == "https" && p.Claims(ctx, u.Host) && pullRequestPath.MatchString(u.Path)
}

var linkPattern = regexp.MustCompile(`^https://github\.com/([^/\s]+)/([^/\s]+)/(issues|pull)/(\d+)`)

func (p *Provider) ParseLink(raw string) (githost.Link, bool) {
	m := linkPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return githost.Link{}, false
	}
	kind := githost.LinkIssue
	if m[3] == "pull" {
		kind = githost.LinkChangeRequest
	}
	return githost.Link{Provider: ProviderID, Kind: kind, Ref: m[2] + "#" + m[4]}, true
}

func (p *Provider) ChangeFiles(ctx context.Context, r githost.Repo, number int) (githost.ChangeFiles, githost.Status) {
	f, s := p.client.PullFiles(ctx, Repo(r), number)
	out := githost.ChangeFiles{NodeID: f.NodeID, HeadSha: f.HeadSha, Open: f.State == "OPEN", Truncated: f.Truncated}
	for _, pf := range f.Files {
		out.Files = append(out.Files, githost.ChangedFile{Path: pf.Path, Viewed: pf.Viewed})
	}
	return out, toStatus(s)
}

func (p *Provider) SetFilesViewed(ctx context.Context, r githost.Repo, nodeID string, paths []string, viewed bool) (map[string]string, githost.Status) {
	failed, s := p.client.SetFilesViewed(ctx, Repo(r), nodeID, paths, viewed)
	return failed, toStatus(s)
}

// toStatus arms RateLimited on exactly the statuses the per-repo breaker has always armed on.
func toStatus(s Status) githost.Status {
	return githost.Status{
		Kind: s.Kind, Path: s.Path, Version: s.Version, Host: s.Host, Account: s.Account,
		Probed: s.Probed, Reason: s.Reason, RateLimited: isRateLimited(s),
	}
}

func toChangeRequests(prs []PR) []githost.ChangeRequest {
	if prs == nil {
		return nil
	}
	out := make([]githost.ChangeRequest, 0, len(prs))
	for _, p := range prs {
		out = append(out, githost.ChangeRequest{
			Number: p.Number, Title: p.Title, URL: p.URL, State: p.State, HeadRef: p.HeadRef, HeadSha: p.HeadSha,
			HeadOwner: p.HeadRepoOwner, BaseRef: p.BaseRef, UpdatedAt: p.UpdatedAt,
		})
	}
	return out
}
