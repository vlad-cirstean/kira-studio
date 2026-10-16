package ghclient

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// graphqlTimeout bounds one `gh api graphql` call; a 50-alias mutation chunk takes longer than a REST read.
const graphqlTimeout = 30 * time.Second

const (
	maxPullFiles       = 3000
	pullFilesPageSize  = 100
	viewedChunkSize    = 50
	viewedStateViewed  = "VIEWED"
	graphqlRateLimited = "GitHub API rate limit exhausted — try again later"
)

// GraphQLVar is one query variable. A string travels via `-f` (never `-F`: `-F` reads a value that
// starts with "@" from a file), an integer via `-F`.
type GraphQLVar struct {
	Name  string
	Str   string
	Int   int
	IsInt bool
}

type graphqlError struct {
	Message string `json:"message"`
	Path    []any  `json:"path"`
}

type graphqlEnvelope struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphqlError  `json:"errors"`
}

func graphqlArgv(host, query string, vars []GraphQLVar) []string {
	args := []string{"api", "graphql", "--hostname", host, "-f", "query=" + query}
	for _, v := range vars {
		if v.IsInt {
			args = append(args, "-F", v.Name+"="+strconv.Itoa(v.Int))
		} else {
			args = append(args, "-f", v.Name+"="+v.Str)
		}
	}
	return args
}

// graphql runs one query with the same auth gate as get. A response with errors[] and no data is a
// forbidden Status carrying the first message; errors[] beside data are returned for the caller to
// map per alias.
func (c *Client) graphql(ctx context.Context, repo Repo, query string, vars []GraphQLVar, out any) (Status, []graphqlError) {
	authStatus := c.discovery.Status(ctx, repo.Host)
	if !authStatus.OK() {
		return authStatus, nil
	}
	res, runErr := c.runner.Run(ctx, authStatus.Path, Spec{Args: graphqlArgv(repo.Host, query, vars), Timeout: graphqlTimeout})
	if runErr != nil || ctx.Err() != nil {
		return classify(repo.Host, res, runErr, ctx.Err()), nil
	}
	var env graphqlEnvelope
	decoded := json.Unmarshal(res.Stdout, &env) == nil
	if decoded && len(env.Errors) > 0 {
		hasData := len(env.Data) > 0 && string(env.Data) != "null"
		if !hasData {
			msg := env.Errors[0].Message
			if strings.Contains(strings.ToLower(msg), "rate limit") {
				msg = graphqlRateLimited
			}
			return Status{Kind: KindForbidden, Host: repo.Host, Reason: reasonOrDefault(msg, "GitHub did not answer — try again later")}, env.Errors
		}
	} else if status := classify(repo.Host, res, nil, nil); !status.OK() {
		return status, nil
	} else if !decoded {
		return Status{Kind: KindForbidden, Host: repo.Host, Reason: reasonUnreadable}, nil
	}
	if out != nil && len(env.Data) > 0 {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return Status{Kind: KindForbidden, Host: repo.Host, Reason: reasonUnreadable}, nil
		}
	}
	return Status{Kind: KindOK, Host: repo.Host}, env.Errors
}

// PullFile is one file of a pull request and whether the viewer marked it viewed.
type PullFile struct {
	Path   string
	Viewed bool
}

// PullFiles is a pull request's node id, head, state and changed files.
type PullFiles struct {
	NodeID  string
	HeadSha string
	State   string
	Files   []PullFile
	// Truncated is true when the PR has more than maxPullFiles files.
	Truncated bool
}

const pullFilesQuery = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid state files(first:100,after:$cursor){nodes{path viewerViewedState} pageInfo{hasNextPage endCursor}}}}}`

type pullFilesData struct {
	Repository struct {
		PullRequest *struct {
			ID         string `json:"id"`
			HeadRefOid string `json:"headRefOid"`
			State      string `json:"state"`
			Files      struct {
				Nodes []struct {
					Path   string `json:"path"`
					Viewed string `json:"viewerViewedState"`
				} `json:"nodes"`
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
			} `json:"files"`
		} `json:"pullRequest"`
	} `json:"repository"`
}

// validObjectID reports whether s is a full SHA-1 or SHA-256 hex object id.
func validObjectID(s string) bool {
	if len(s) != 40 && len(s) != 64 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// PullFiles reads the PR's files with their viewed state, paged to the end (stopping at 3000 files).
func (c *Client) PullFiles(ctx context.Context, repo Repo, number int) (PullFiles, Status) {
	var out PullFiles
	cursor := ""
	done := false
	for page := 0; !done && page <= maxPullFiles/pullFilesPageSize; page++ {
		vars := []GraphQLVar{
			{Name: "owner", Str: repo.Owner}, {Name: "name", Str: repo.Name}, {Name: "number", Int: number, IsInt: true},
		}
		if cursor != "" {
			vars = append(vars, GraphQLVar{Name: "cursor", Str: cursor})
		}
		var data pullFilesData
		status, _ := c.graphql(ctx, repo, pullFilesQuery, vars, &data)
		if !status.OK() {
			return PullFiles{}, status
		}
		pr := data.Repository.PullRequest
		if pr == nil {
			return PullFiles{}, Status{Kind: KindForbidden, Host: repo.Host, Reason: "not found, or you cannot see it"}
		}
		if !validObjectID(pr.HeadRefOid) {
			return PullFiles{}, Status{Kind: KindForbidden, Host: repo.Host, Reason: reasonUnreadable}
		}
		out.NodeID, out.HeadSha, out.State = pr.ID, pr.HeadRefOid, pr.State
		for _, n := range pr.Files.Nodes {
			out.Files = append(out.Files, PullFile{Path: n.Path, Viewed: n.Viewed == viewedStateViewed})
		}
		if len(out.Files) >= maxPullFiles {
			out.Truncated = pr.Files.PageInfo.HasNextPage || len(out.Files) > maxPullFiles
			out.Files = out.Files[:min(len(out.Files), maxPullFiles)]
			done = true
			break
		}
		if !pr.Files.PageInfo.HasNextPage || pr.Files.PageInfo.EndCursor == "" {
			done = true
			break
		}
		// A page with no nodes or a cursor that did not advance would loop without progress.
		if len(pr.Files.Nodes) == 0 || pr.Files.PageInfo.EndCursor == cursor {
			out.Truncated = true
			done = true
			break
		}
		cursor = pr.Files.PageInfo.EndCursor
	}
	if !done {
		out.Truncated = true
	}
	return out, Status{Kind: KindOK, Host: repo.Host}
}

// viewedMutation builds one chunk's query from indexes only; the paths travel as variables.
func viewedMutation(n int, viewed bool) string {
	field := "markFileAsViewed"
	if !viewed {
		field = "unmarkFileAsViewed"
	}
	var b strings.Builder
	b.WriteString("mutation($pr:ID!")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, ",$p%d:String!", i)
	}
	b.WriteString("){")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "m%d:%s(input:{pullRequestId:$pr,path:$p%d}){clientMutationId} ", i, field, i)
	}
	b.WriteString("}")
	return b.String()
}

// SetFilesViewed marks (viewed) or unmarks paths on the PR in chunks of 50 aliased mutations. failed
// maps a path to GitHub's error for it; a chunk-level failure returns the Status with the paths of
// that chunk and every later chunk in failed.
func (c *Client) SetFilesViewed(ctx context.Context, repo Repo, prNodeID string, paths []string, viewed bool) (map[string]string, Status) {
	failed := map[string]string{}
	ok := Status{Kind: KindOK, Host: repo.Host}
	for start := 0; start < len(paths); start += viewedChunkSize {
		chunk := paths[start:min(start+viewedChunkSize, len(paths))]
		vars := make([]GraphQLVar, 0, 1+len(chunk))
		vars = append(vars, GraphQLVar{Name: "pr", Str: prNodeID})
		for i, p := range chunk {
			vars = append(vars, GraphQLVar{Name: "p" + strconv.Itoa(i), Str: p})
		}
		status, errs := c.graphql(ctx, repo, viewedMutation(len(chunk), viewed), vars, nil)
		if !status.OK() {
			for _, p := range paths[start:] {
				failed[p] = status.Reason
			}
			return failed, status
		}
		for _, e := range errs {
			if len(e.Path) == 0 {
				continue
			}
			alias, _ := e.Path[0].(string)
			if idx, err := strconv.Atoi(strings.TrimPrefix(alias, "m")); err == nil && strings.HasPrefix(alias, "m") && idx >= 0 && idx < len(chunk) {
				failed[chunk[idx]] = e.Message
			}
		}
	}
	return failed, ok
}
