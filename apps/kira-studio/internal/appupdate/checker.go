// Package appupdate is the whole update-availability check: one plain net/http GET against
// GitHub's public releases/latest endpoint, self-contained and dependency-free (no ghclient, no
// httpclient, no Wails import — drivable from a plain httptest server, matching the same
// self-contained shape internal/httpclient states as its own contract).
//
// internal/ghclient is deliberately not reused: every ghclient call is gated on a working,
// authenticated `gh` CLI (ghclient/discovery.go), and an update check that only runs for users
// who have installed and logged into the GitHub CLI is not an update check. internal/httpclient
// is not reused either — it is the user-facing request builder (redirect recording, wire capture,
// truncation reporting) for a question this package is not asking.
package appupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"golang.org/x/sync/singleflight"
)

const (
	repoOwner = "vlad-cirstean"
	repoName  = "kira-studio"

	latestReleaseURL = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases/latest"
	releasesPageURL  = "https://github.com/" + repoOwner + "/" + repoName + "/releases"

	requestTimeout = 10 * time.Second // ghclient's own apiTimeout, same reasoning
	maxBodyBytes   = 1 << 20          // a releases/latest body is tens of KiB; this is headroom

	// apiVersionHeader restates ghclient/api.go's own unexported constant of the same name — GitHub's
	// REST API version pin, so a future GitHub-side default-version bump can never silently reshape
	// the decoded fields here.
	apiVersionHeader = "2022-11-28"
)

// okInterval/failureInterval mirror ghclient/discovery.go's own okTTL/notOKTTL split: a good
// answer is worth holding for a long time, a failure is worth retrying sooner.
const (
	okInterval      = 6 * time.Hour
	failureInterval = 30 * time.Minute
)

// release is the subset of GitHub's release object this package reads.
type release struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// Result is the whole answer Status returns.
type Result struct {
	UpdateAvailable bool
	CurrentVersion  string
	LatestVersion   string
	releaseURL      string // unexported: never crosses the wire — see internal/bridge/update.go
}

// Checker owns one cached answer per app process. Safe for concurrent use.
type Checker struct {
	running string
	fetch   func(ctx context.Context) (release, error) // seam; the real one is httpFetch
	now     func() time.Time

	group singleflight.Group

	mu        sync.Mutex
	checkedAt time.Time
	lastOK    bool
	result    Result
}

// NewChecker builds a Checker over the real network fetch, for runningVersion (buildinfo.Version).
func NewChecker(runningVersion string) *Checker {
	return &Checker{
		running: runningVersion,
		fetch:   httpFetch,
		now:     time.Now,
	}
}

// Status returns the current cached answer, refreshing it first if it is due. It never returns an
// error: a failed check is silence, logged at debug level and nothing more (§3.3).
func (c *Checker) Status(ctx context.Context) Result {
	if !isReleaseBuild(c.running) {
		return Result{CurrentVersion: c.running}
	}

	if !c.dueForCheck() {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.result
	}

	v, _, _ := c.group.Do("latest", func() (any, error) {
		return c.refresh(ctx), nil
	})
	return v.(Result)
}

// dueForCheck reports whether the cached answer is stale enough to warrant a real network call —
// okInterval after a successful check, failureInterval after a failed one.
func (c *Checker) dueForCheck() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.checkedAt.IsZero() {
		return true
	}
	interval := failureInterval
	if c.lastOK {
		interval = okInterval
	}
	return c.now().Sub(c.checkedAt) >= interval
}

// refresh performs the real fetch and updates the cache. On error the previous result is left in
// place — only checkedAt and lastOK move — so a transient failure never blanks out a result a
// prior successful check already produced.
func (c *Checker) refresh(ctx context.Context) Result {
	rel, err := c.fetch(ctx)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.checkedAt = c.now()
	if err != nil {
		c.lastOK = false
		slog.Debug("appupdate: check failed", "scope", "appupdate", "err", err)
		return c.result
	}
	c.lastOK = true
	c.result = buildResult(c.running, rel)
	return c.result
}

// buildResult turns a decoded release into this package's Result, skipping a draft or prerelease
// even though releases/latest already excludes both — one `if` against a server-side guarantee
// this app does not control.
func buildResult(running string, rel release) Result {
	result := Result{CurrentVersion: running, LatestVersion: rel.TagName}
	if rel.Draft || rel.Prerelease {
		return result
	}
	if !updateAvailable(running, rel.TagName) {
		return result
	}
	result.UpdateAvailable = true
	result.releaseURL = safeReleaseURL(rel.HTMLURL)
	return result
}

// ReleaseURL is what OpenReleasePage opens: the last-checked release's own page when it validated,
// the repository's /releases page otherwise — including when no check has ever succeeded.
func (c *Checker) ReleaseURL() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.result.releaseURL == "" {
		return releasesPageURL
	}
	return c.result.releaseURL
}

// safeReleaseURL returns raw only when it is a github.com https URL under this repository's own
// /releases/ path — anything else returns releasesPageURL instead. Not defensive theatre:
// BrowserManager.OpenURL (pkg/application) validates nothing at all, and macOS `open` will act on
// any scheme it recognises, so this is the only check that ever runs before a URL reaches it.
func safeReleaseURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return releasesPageURL
	}
	if u.Scheme != "https" || u.Host != "github.com" {
		return releasesPageURL
	}
	if !strings.HasPrefix(u.Path, "/"+repoOwner+"/"+repoName+"/releases/") {
		return releasesPageURL
	}
	return raw
}

// httpClient is a package-level *http.Client over one *http.Transport, mirroring
// internal/httpclient's own sharedClient precedent (connection reuse, and a proxy-aware transport
// so a user behind a corporate proxy is not silently broken). TLS config left nil, so verification
// is on with no opt-out.
var httpClient = &http.Client{
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	},
}

// httpFetch is the real network call behind Checker.fetch. Any status other than 200 is an error
// — 404 (no published release yet) and 403 (rate-limited) included, which is exactly what makes
// them mean silence rather than a surfaced failure.
func httpFetch(ctx context.Context) (release, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseURL, nil)
	if err != nil {
		return release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", apiVersionHeader)
	req.Header.Set("User-Agent", "Kira Studio/"+buildinfo.Version)

	resp, err := httpClient.Do(req)
	if err != nil {
		return release{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return release{}, fmt.Errorf("appupdate: unexpected status %d", resp.StatusCode)
	}

	var rel release
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&rel); err != nil {
		return release{}, err
	}
	return rel, nil
}
