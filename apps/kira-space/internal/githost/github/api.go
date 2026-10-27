package github

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// apiVersionHeader is GitHub's own REST API version pin (D4) — every `gh api` call this package
// makes is pinned to it, so a future GitHub-side default-version bump can never silently change
// this package's own field shapes out from under it.
const apiVersionHeader = "2022-11-28"

// Client is this package's whole GitHub-facing surface (D1) — every future GitHub feature this app
// grows adds a method here (§9), never a second client type.
type Client struct {
	discovery *Discovery
	runner    Runner
}

// NewClient constructs a Client over discovery/runner.
func NewClient(discovery *Discovery, runner Runner) *Client {
	return &Client{discovery: discovery, runner: runner}
}

// Hosts passes through to the underlying Discovery's own Hosts (the "is this a GitHub repository"
// test: github.com, or a host this Client has ever probed successfully) — kept on Client, not
// exposed as a separate Discovery accessor, so Client stays the single surface every caller above
// this package reaches through.
func (c *Client) Hosts(ctx context.Context) []string {
	return c.discovery.Hosts(ctx)
}

// Account is the `gh` login Discovery parsed for host ("" when unauthenticated or unknown).
func (c *Client) Account(ctx context.Context, host string) string {
	return c.discovery.Status(ctx, host).Account
}

// commonArgv builds the common prefix: `gh api --hostname <host> --method GET -H "Accept:
// application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" <path>` — one place so every
// one of the three calls in pr.go, and this file's own argv-golden test, share byte-for-byte the
// same flags.
func commonArgv(host, path string) []string {
	return methodArgv(host, "GET", path)
}

func methodArgv(host, method, path string) []string {
	return []string{
		"api", "--hostname", host, "--method", method,
		"-H", "Accept: application/vnd.github+json",
		"-H", "X-GitHub-Api-Version: " + apiVersionHeader,
		path,
	}
}

// get is every one of pr.go's three calls' shared executor: resolve host's own Status first (no
// spawn at all when it is not "ok" — the "Client never returns a Go error", every outcome instead
// carries in Status), run `gh api` with commonArgv(host, path), classify the raw result, and decode
// the JSON body into out only on an "ok" classification. ctx is checked before classify would see
// it, mirroring gitclient.Classify's own "cancellation first" discipline (errors.go's own doc
// comment says the same).
func (c *Client) get(ctx context.Context, repo Repo, path string, out any) Status {
	return c.call(ctx, repo, commonArgv(repo.Host, path), out)
}

// call runs one `gh api` argv under the same auth gate, timeout and classification as get.
func (c *Client) call(ctx context.Context, repo Repo, args []string, out any) Status {
	return c.callWithin(ctx, repo, args, out, apiTimeout, false)
}

// callWithin is call with an explicit timeout. A write that times out may still have landed, so
// its reason says so instead of reading as "not sent" and inviting a duplicate.
func (c *Client) callWithin(ctx context.Context, repo Repo, args []string, out any, timeout time.Duration, write bool) Status {
	authStatus := c.discovery.Status(ctx, repo.Host)
	if !authStatus.OK() {
		return authStatus
	}

	res, runErr := c.runner.Run(ctx, authStatus.Path, Spec{Args: args, Timeout: timeout})
	status := classify(repo.Host, res, runErr, ctx.Err())
	if write && ctx.Err() == nil && errors.Is(runErr, context.DeadlineExceeded) {
		status.Reason = writeTimeoutReason
	}
	if !status.OK() {
		return status
	}

	if out != nil {
		if err := json.Unmarshal(res.Stdout, out); err != nil {
			return Status{Kind: KindForbidden, Host: repo.Host, Reason: reasonUnreadable}
		}
	}
	return status
}
