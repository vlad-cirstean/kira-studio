package azure

import (
	"context"
	"strconv"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// Sync without an update time. Azure DevOps stamps no "updated" on a pull request, so Page orders
// by pull request id, which is creation order, and ChangeRequest.UpdatedAt is the creation time:
// the delta walk stops at the first pull request older than its watermark, so every pull request
// created since the last run is above it and none is missed. State, head, review and checks
// changes of an open pull request come from Checks, which crsync runs for every open row on its
// sweep. A pull request that left active is read by id and its new state stored. An abandoned pull
// request that is reactivated stays closed in the index until a re-backfill.

// Page reads pull requests, closed ones included, newest created first. cursor is the skip offset.
func (p *Provider) Page(ctx context.Context, r githost.Repo, cursor string, first int) (githost.ChangeRequestPage, githost.Status) {
	skip := 0
	if cursor != "" {
		n, err := strconv.Atoi(cursor)
		if err != nil || n < 0 {
			return githost.ChangeRequestPage{}, status("", githost.KindForbidden, "invalid page cursor")
		}
		skip = n
	}
	if first <= 0 || first > listPage {
		first = listPage
	}
	raw, st := p.client.prList(ctx, r, "--status", "all", "--top", strconv.Itoa(first), "--skip", strconv.Itoa(skip))
	if !st.OK() {
		return githost.ChangeRequestPage{}, st
	}
	return githost.ChangeRequestPage{
		Items: mapPRs(r, raw), EndCursor: strconv.Itoa(skip + len(raw)), HasNext: len(raw) == first,
	}, st
}

// Probe reads the newest pull request id; a new id means something was created. Azure reports no
// rate limit and has no conditional request, so one cheap spawn is the whole probe.
func (p *Provider) Probe(ctx context.Context, r githost.Repo, etag string) (bool, string, githost.Status) {
	org, project, ok := split(r)
	if !ok {
		return false, "", invalidRepo(r)
	}
	var id *int
	st := p.client.callJSON(ctx, orgURL(org), false,
		argv([]string{"repos", "pr", "list"}, orgURL(org),
			"--project", project, "--repository", r.Name, "--status", "all", "--top", "1", "--query", "[0].pullRequestId"), &id)
	if !st.OK() {
		return false, "", st
	}
	newETag := "0"
	if id != nil {
		newETag = strconv.Itoa(*id)
	}
	return etag == "" || etag != newETag, newETag, st
}

// Checks returns the current state of the pull requests with nodeIDs (their numbers).
func (p *Provider) Checks(ctx context.Context, r githost.Repo, nodeIDs []string) ([]githost.ChangeRequest, githost.Status) {
	ids := make([]int, 0, len(nodeIDs))
	for _, s := range nodeIDs {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			ids = append(ids, n)
		}
	}
	return p.client.checks(ctx, r, ids)
}
