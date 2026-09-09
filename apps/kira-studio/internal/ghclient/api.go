package ghclient

import (
	"context"
	"encoding/json"
)

// apiVersionHeader is GitHub's own REST API version pin (D4) — every `gh api` call this package
// makes is pinned to it, so a future GitHub-side default-version bump can never silently change
// this package's own field shapes out from under it.
const apiVersionHeader = "2022-11-28"

// Client is ghclient's whole GitHub-facing surface (D1) — every future GitHub feature this app
// grows adds a method here (§9), never a second client type.
type Client struct {
	discovery *Discovery
	runner    Runner
}

// NewClient constructs a Client over discovery/runner.
func NewClient(discovery *Discovery, runner Runner) *Client {
	return &Client{discovery: discovery, runner: runner}
}

// commonArgv builds D4's own common prefix: `gh api --hostname <host> --method GET -H "Accept:
// application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" <path>` — one place so every
// one of the three calls in pr.go, and this file's own argv-golden test, share byte-for-byte the
// same flags.
func commonArgv(host, path string) []string {
	return []string{
		"api", "--hostname", host, "--method", "GET",
		"-H", "Accept: application/vnd.github+json",
		"-H", "X-GitHub-Api-Version: " + apiVersionHeader,
		path,
	}
}

// get is every one of pr.go's three calls' shared executor: resolve host's own Status first (no
// spawn at all when it is not "ok" — D1's "Client never returns a Go error", every outcome instead
// carries in Status), run `gh api` with commonArgv(host, path), classify the raw result, and decode
// the JSON body into out only on an "ok" classification. ctx is checked before classify would see
// it, mirroring gitclient.Classify's own "cancellation first" discipline (errors.go's own doc
// comment says the same).
func (c *Client) get(ctx context.Context, repo Repo, path string, out any) Status {
	authStatus := c.discovery.Status(ctx, repo.Host)
	if !authStatus.OK() {
		return authStatus
	}

	res, runErr := c.runner.Run(ctx, authStatus.Path, Spec{Args: commonArgv(repo.Host, path), Timeout: apiTimeout})
	status := classify(repo.Host, res, runErr, ctx.Err())
	if !status.OK() {
		return status
	}

	if out != nil {
		if err := json.Unmarshal(res.Stdout, out); err != nil {
			return Status{Kind: KindForbidden, Host: repo.Host, Reason: "GitHub returned an unreadable response"}
		}
	}
	return status
}
