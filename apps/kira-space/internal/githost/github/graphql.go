package github

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// graphqlTimeout bounds one `gh api graphql` call; a GraphQL page takes longer than a REST read.
const graphqlTimeout = 30 * time.Second

const graphqlRateLimited = "GitHub API rate limit exhausted — try again later"

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
	return c.graphqlWithin(ctx, repo, query, vars, out, graphqlTimeout, false)
}

// graphqlWithin is graphql with an explicit timeout. A write that times out may still have landed,
// so its reason says so.
func (c *Client) graphqlWithin(ctx context.Context, repo Repo, query string, vars []GraphQLVar, out any, timeout time.Duration, write bool) (Status, []graphqlError) {
	authStatus := c.discovery.Status(ctx, repo.Host)
	if !authStatus.OK() {
		return authStatus, nil
	}
	res, runErr := c.runner.Run(ctx, authStatus.Path, Spec{Args: graphqlArgv(repo.Host, query, vars), Timeout: timeout})
	if runErr != nil || ctx.Err() != nil {
		st := classify(repo.Host, res, runErr, ctx.Err())
		if write && ctx.Err() == nil && errors.Is(runErr, context.DeadlineExceeded) {
			st.Reason = writeTimeoutReason
		}
		return st, nil
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
