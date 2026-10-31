package ade

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// issuetracker.go surfaces a task's linked issue (P417): an issue artifact, the pull requests that name
// its key, and the issue line of the task tab. The tracker CLI owns the credentials; this file only asks.

const (
	// taskIssueTimeout bounds TaskIssue; the artifact sources keep their own, shorter budget.
	taskIssueTimeout = 10 * time.Second
	// keySearchLimit bounds one code host search and one index read for an issue key.
	keySearchLimit = 50

	gapChangeRequestsMissing = "changeRequestsMissing"
	reasonNoTracker          = "noTracker"
)

// trackerRef is the issue the task links, parsed by p: the pasted URL first, else the bare key.
func trackerRef(p issuetracker.Provider, t model.AdeTask) (issuetracker.Ref, bool) {
	for _, raw := range []string{t.JiraURL, t.JiraKey} {
		if raw == "" {
			continue
		}
		if ref, ok := p.ParseRef(raw); ok {
			return ref, true
		}
	}
	return issuetracker.Ref{}, false
}

// staticIssueArtifact is the row a task shows while its tracker cannot answer: the stored link only.
func staticIssueArtifact(p issuetracker.Provider, t model.AdeTask, ref issuetracker.Ref) adewire.Artifact {
	return adewire.Artifact{
		Kind: model.AdeArtifactIssue, Title: ref.Key, URL: t.JiraURL, Ref: ref.Key, Source: p.ID(), CreatedAt: t.CreatedAt,
	}
}

type trackerSource struct {
	b *TaskBoard
	p issuetracker.Provider
}

func (s trackerSource) Name() string { return s.p.ID() }

// Artifacts never returns an error: a tracker failure keeps the static row and adds a gap naming why.
func (s trackerSource) Artifacts(ctx context.Context, sc ArtifactScope) ([]adewire.Artifact, []adewire.ArtifactGap, error) {
	ref, ok := trackerRef(s.p, sc.Task)
	if !ok {
		return nil, nil, nil
	}
	iss, err := s.p.Issue(ctx, ref)
	if err != nil {
		return []adewire.Artifact{staticIssueArtifact(s.p, sc.Task, ref)},
			[]adewire.ArtifactGap{{Source: s.p.ID(), Reason: issuetracker.Reason(err)}}, nil
	}
	id := s.p.ID()
	title := iss.Title
	if title == "" {
		title = iss.Ref.Key
	}
	out := []adewire.Artifact{{
		Kind: model.AdeArtifactIssue, Title: title, URL: iss.Ref.URL, Ref: iss.Ref.Key, Status: iss.Status,
		Source: id, CreatedAt: sc.Task.CreatedAt,
	}}
	for _, cr := range iss.ChangeRequests {
		out = append(out, adewire.Artifact{
			Kind: model.AdeArtifactChangeRequest, Title: cr.Title, URL: cr.URL, Ref: cr.Ref, Status: cr.State, Repo: cr.Repo,
			Source: id,
		})
	}
	var gaps []adewire.ArtifactGap
	switch {
	case iss.ChangeRequestsReason != "":
		gaps = append(gaps, adewire.ArtifactGap{Source: id, Reason: changeRequestsReason(iss.ChangeRequestsReason)})
	case iss.Summary.Known && iss.Summary.Count > len(iss.ChangeRequests):
		gaps = append(gaps, adewire.ArtifactGap{
			Source: id, Reason: gapChangeRequestsMissing, Count: iss.Summary.Count - len(iss.ChangeRequests),
		})
	}
	return out, gaps, nil
}

// changeRequestsReason names a failed pull request lookup: changeRequestsFailed, changeRequestsUnavailable...
func changeRequestsReason(reason string) string {
	return "changeRequests" + strings.ToUpper(reason[:1]) + reason[1:]
}

// TaskIssue reads the issue the task links. A tracker failure comes back as Reason, not as an error;
// the call fails only when the task is unreadable.
func (b *TaskBoard) TaskIssue(ctx context.Context, taskID string) (adewire.TaskIssue, error) {
	task, err := b.deps.Tasks.GetTask(taskID)
	if err != nil {
		return adewire.TaskIssue{}, err
	}
	for _, p := range b.deps.Trackers.All() {
		ref, ok := trackerRef(p, task)
		if !ok {
			continue
		}
		ictx, cancel := context.WithTimeout(ctx, taskIssueTimeout)
		iss, err := p.Issue(ictx, ref)
		cancel()
		out := adewire.TaskIssue{
			Provider: p.ID(), Label: p.Terms().Label, Key: ref.Key, URL: task.JiraURL, ChangeRequests: []adewire.IssueChangeRequest{},
			Summary: adewire.IssueSummary{Providers: []string{}},
		}
		if err != nil {
			out.Reason = issuetracker.Reason(err)
			return out, nil
		}
		out.Key, out.URL, out.Title = iss.Ref.Key, iss.Ref.URL, iss.Title
		out.Status, out.StatusCategory = iss.Status, iss.StatusCategory
		out.ChangeRequestsReason = iss.ChangeRequestsReason
		out.Summary = adewire.IssueSummary{
			Known: iss.Summary.Known, Count: iss.Summary.Count, State: iss.Summary.State, Providers: append([]string{}, iss.Summary.Providers...),
		}
		for _, cr := range iss.ChangeRequests {
			out.ChangeRequests = append(out.ChangeRequests, adewire.IssueChangeRequest{
				Title: cr.Title, URL: cr.URL, Ref: cr.Ref, State: cr.State, Repo: cr.Repo,
			})
		}
		return out, nil
	}
	return adewire.TaskIssue{Reason: reasonNoTracker, ChangeRequests: []adewire.IssueChangeRequest{}, Summary: adewire.IssueSummary{Providers: []string{}}}, nil
}

// HeadIndex is the persisted change request index, searched by head branch.
type HeadIndex interface {
	ByHeadContaining(text string, limit int) ([]model.GitHostChangeRequestHit, error)
}

// KeyChangeRequests finds the pull requests that carry an issue key: in the title through each code host's
// search, and in the head branch through the sync index of every imported repository. Jira's GitHub app
// links pull requests by the same rule (key in branch, title or commit); commit-only links are not found.
// Rows found are returned even beside an error, so a failed host leaves the index matches in place.
func KeyChangeRequests(hosts *githost.Registry, index HeadIndex) func(ctx context.Context, key string) ([]issuetracker.ChangeRequest, error) {
	return func(ctx context.Context, key string) ([]issuetracker.ChangeRequest, error) {
		in := keyBoundary(key)
		var out []issuetracker.ChangeRequest
		seen := map[string]bool{}
		add := func(provider string, cr githost.ChangeRequest, repoKeyTail string) {
			if cr.URL == "" || seen[cr.URL] {
				return
			}
			seen[cr.URL] = true
			out = append(out, issuetracker.ChangeRequest{
				Title: cr.Title, URL: cr.URL, Ref: fmt.Sprintf("#%d", cr.Number), State: cr.State,
				Repo: changeRequestRepo(cr.URL, repoKeyTail), Provider: provider,
			})
		}
		var failed error
		for _, p := range hosts.All() {
			s, ok := p.(githost.ChangeRequestSearch)
			if !ok {
				continue
			}
			crs, st := s.SearchChangeRequests(ctx, key, keySearchLimit)
			if st.Kind == githost.KindNotFound {
				continue // a host whose CLI is not installed is a host the user does not use; Settings shows it
			}
			if !st.OK() {
				if failed == nil {
					failed = searchError(st)
				}
				continue
			}
			for _, cr := range crs {
				if in.MatchString(cr.Title) {
					add(p.ID(), cr, "")
				}
			}
		}
		if index != nil {
			hits, err := index.ByHeadContaining(key, keySearchLimit)
			if err != nil && failed == nil {
				failed = err
			}
			for _, h := range hits {
				if !in.MatchString(h.HeadRef) {
					continue
				}
				provider, _, _ := strings.Cut(h.RepoKey, "|")
				add(provider, githost.ChangeRequest{Number: h.Number, Title: h.Title, URL: h.URL, State: indexState(h)}, repoKeyTail(h.RepoKey))
			}
		}
		return out, failed
	}
}

// keyBoundary matches key as a whole token: PROJ-1 must not match PROJ-12 or XPROJ-1.
func keyBoundary(key string) *regexp.Regexp {
	return regexp.MustCompile(`(^|[^A-Za-z0-9])` + regexp.QuoteMeta(key) + `([^0-9]|$)`)
}

func searchError(st githost.Status) error {
	if st.Kind == githost.KindUnauthenticated {
		return fmt.Errorf("%w: %s", issuetracker.ErrUnauthenticated, st.Reason)
	}
	return errors.New(st.Reason)
}

func indexState(h model.GitHostChangeRequestHit) string {
	if h.Draft && h.State == "open" {
		return "draft"
	}
	return h.State
}

// repoKeyTail is the owner/name part of a change request index key (provider|host|owner/name).
func repoKeyTail(repoKey string) string {
	parts := strings.SplitN(repoKey, "|", 3)
	if len(parts) == 3 {
		return parts[2]
	}
	return ""
}

// changeRequestRepo is owner/name read from a change request URL (.../owner/name/pull/1 or
// .../owner/name/-/merge_requests/1), else the fallback.
func changeRequestRepo(rawURL, fallback string) string {
	rest := rawURL
	if i := strings.Index(rest, "://"); i >= 0 {
		rest = rest[i+3:]
	}
	if i := strings.Index(rest, "/"); i >= 0 {
		rest = rest[i+1:]
	} else {
		return fallback
	}
	for _, marker := range []string{"/-/", "/pull/", "/merge_requests/"} {
		if i := strings.Index(rest, marker); i > 0 {
			return rest[:i]
		}
	}
	return fallback
}
