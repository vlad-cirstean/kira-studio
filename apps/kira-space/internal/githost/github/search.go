package github

import (
	"context"
	"strconv"
	"strings"
)

// primaryHost is the host `gh search` runs against: gh has no --hostname flag for it.
const primaryHost = "github.com"

// maxSearchResults is gh's own cap for one search (--limit).
const maxSearchResults = 100

type searchResult struct {
	Number  int    `json:"number"`
	Title   string `json:"title"`
	State   string `json:"state"`
	URL     string `json:"url"`
	IsDraft bool   `json:"isDraft"`
}

// SearchPulls finds pull requests whose title contains text, newest first, with `gh search prs`. gh's
// state is open or closed, so a second `--merged` search marks the merged ones; if it fails the
// merged ones stay "closed".
func (c *Client) SearchPulls(ctx context.Context, text string, limit int) ([]PR, Status) {
	limit = min(max(limit, 1), maxSearchResults)
	repo := Repo{Host: primaryHost}
	var found []searchResult
	if st := c.call(ctx, repo, searchArgv(text, limit, false), &found); !st.OK() {
		return nil, st
	}
	merged := map[string]bool{}
	var mergedFound []searchResult
	if st := c.call(ctx, repo, searchArgv(text, limit, true), &mergedFound); st.OK() {
		for _, r := range mergedFound {
			merged[r.URL] = true
		}
	}
	out := make([]PR, 0, len(found))
	for _, r := range found {
		state := strings.ToLower(r.State)
		switch {
		case merged[r.URL]:
			state = "merged"
		case state == "open" && r.IsDraft:
			state = "draft"
		}
		out = append(out, PR{Number: r.Number, Title: r.Title, URL: r.URL, State: state})
	}
	return out, Status{Kind: KindOK, Host: primaryHost}
}

func searchArgv(text string, limit int, merged bool) []string {
	args := []string{"search", "prs", `"` + strings.ReplaceAll(text, `"`, "") + `"`, "--match", "title", "--sort", "updated",
		"--json", "number,title,state,url,isDraft", "--limit", strconv.Itoa(limit)}
	if merged {
		args = append(args, "--merged")
	}
	return args
}
