package azure

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// searchPages is how many pages of the default project's newest pull requests one search reads.
const searchPages = 2

// SearchChangeRequests finds pull requests whose title contains text in the default organization
// and project, newest first. Without both defaults the host reports notFound, like an absent CLI.
func (p *Provider) SearchChangeRequests(ctx context.Context, text string, limit int) ([]githost.ChangeRequest, githost.Status) {
	def, st := p.client.discovery.Defaults(ctx)
	if !st.OK() {
		return nil, st
	}
	if def.OrgURL == "" || def.Project == "" {
		return nil, status(def.OrgURL, githost.KindNotFound, reasonDefaults)
	}
	if auth := p.client.discovery.Status(ctx, def.OrgURL); !auth.OK() {
		return nil, auth
	}
	var raw []rawPR
	for page := range searchPages {
		var rows []rawPR
		st = p.client.callJSON(ctx, def.OrgURL, false,
			argv([]string{"repos", "pr", "list"}, def.OrgURL,
				"--project", def.Project, "--status", "all", "--top", strconv.Itoa(listPage),
				"--skip", strconv.Itoa(page*listPage), "--query", prSearchQuery), &rows)
		if !st.OK() {
			return nil, st
		}
		raw = append(raw, rows...)
		if len(rows) < listPage {
			break
		}
	}
	org := orgName(def.OrgURL)
	needle := strings.ToLower(text)
	var out []githost.ChangeRequest
	for _, pr := range raw {
		if pr.Repo == "" || !strings.Contains(strings.ToLower(pr.Title), needle) {
			continue
		}
		r := githost.Repo{Host: Host, Owner: org + "/" + def.Project, Name: pr.Repo}
		cr := mapPR(r, pr)
		out = append(out, githost.ChangeRequest{Number: cr.Number, Title: cr.Title, URL: cr.URL, State: cr.State})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Number > out[j].Number })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, st
}
