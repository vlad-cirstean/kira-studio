package azure

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// The cache window is asymmetric: a healthy az rarely needs re-checking, while a signed-out or
// unconfigured one is exactly what a user fixes in another terminal.
const (
	okTTL    = 5 * time.Minute
	notOKTTL = 30 * time.Second

	versionTimeout  = 15 * time.Second
	defaultsTimeout = 10 * time.Second
	probeTimeout    = 20 * time.Second
	accountTimeout  = 10 * time.Second
)

type cacheEntry struct {
	status githost.Status
	at     time.Time
}

// Defaults are the organization and project `az devops configure` holds.
type Defaults struct {
	OrgURL, Project string
}

type toolEntry struct {
	status githost.Status // Kind ok carries Path and Version
	at     time.Time
}

type defaultsEntry struct {
	d  Defaults
	at time.Time
}

// Discovery locates az, checks the azure-devops extension and probes sign-in per organization,
// cached per organization URL.
type Discovery struct {
	locator Locator
	runner  Runner
	clock   Clock

	mu       sync.Mutex
	cache    map[string]cacheEntry
	tool     *toolEntry
	defaults *defaultsEntry
}

// NewDiscovery constructs a Discovery over the given seams.
func NewDiscovery(locator Locator, runner Runner, clock Clock) *Discovery {
	return &Discovery{locator: locator, runner: runner, clock: clock, cache: map[string]cacheEntry{}}
}

func fresh(ok bool, at, now time.Time) bool {
	ttl := notOKTTL
	if ok {
		ttl = okTTL
	}
	return now.Sub(at) < ttl
}

// Status is whether az can act on org (an organization URL). "" means the default organization.
func (d *Discovery) Status(ctx context.Context, org string) githost.Status {
	d.mu.Lock()
	if e, ok := d.cache[org]; ok && fresh(e.status.OK(), e.at, d.clock.Now()) {
		d.mu.Unlock()
		return e.status
	}
	d.mu.Unlock()

	st := d.probe(ctx, org)
	if errors.Is(ctx.Err(), context.Canceled) {
		return st // a caller's cancellation says nothing about az
	}
	d.mu.Lock()
	d.cache[org] = cacheEntry{status: st, at: d.clock.Now()}
	d.mu.Unlock()
	return st
}

// Forget drops the cached probe of org ("" is the default organization), so the next Status asks az again.
func (d *Discovery) Forget(org string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.cache, org)
}

// ForgetDefaults drops the cached defaults and the probes that depend on them.
func (d *Discovery) ForgetDefaults() {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.cache, "")
	if d.defaults != nil {
		delete(d.cache, d.defaults.d.OrgURL)
	}
	d.defaults, d.tool = nil, nil
}

func (d *Discovery) probe(ctx context.Context, org string) githost.Status {
	tool := d.az(ctx)
	if !tool.OK() {
		tool.Site = org
		return tool
	}
	if org == "" {
		def, st := d.loadDefaults(ctx, tool.Path)
		if !st.OK() {
			return st
		}
		if def.OrgURL == "" {
			return status("", githost.KindUnauthenticated, reasonDefaults)
		}
		return d.Status(ctx, def.OrgURL)
	}
	_, err := d.run(ctx, tool.Path, probeTimeout, argv([]string{"devops", "project", "list"}, org, "--top", "1"))
	if st := classify(org, err, ctx.Err(), false); !st.OK() {
		st.Path = tool.Path
		return st
	}
	st := status(org, githost.KindOK, "")
	st.Path, st.Version = tool.Path, tool.Version
	st.Account = d.account(ctx, tool.Path)
	return st
}

// az resolves the binary and the extension, cached separately from any organization.
func (d *Discovery) az(ctx context.Context) githost.Status {
	d.mu.Lock()
	if t := d.tool; t != nil && fresh(t.status.OK(), t.at, d.clock.Now()) {
		d.mu.Unlock()
		return t.status
	}
	d.mu.Unlock()
	st := d.probeAz(ctx)
	if !errors.Is(ctx.Err(), context.Canceled) {
		d.mu.Lock()
		d.tool = &toolEntry{status: st, at: d.clock.Now()}
		d.mu.Unlock()
	}
	return st
}

func (d *Discovery) probeAz(ctx context.Context) githost.Status {
	path, probed, found := d.locator.Locate()
	if !found {
		st := status("", githost.KindNotFound, "Azure CLI is unavailable — install `az` to see Azure Repos pull requests")
		st.Probed = probed
		return st
	}
	out, err := d.run(ctx, path, versionTimeout, []string{"version", "--only-show-errors", "-o", "json"})
	if err != nil {
		st := classify("", err, ctx.Err(), false)
		st.Path = path
		if st.Kind == githost.KindForbidden {
			st.Kind = githost.KindNotFound
		}
		return st
	}
	version, hasExt, ok := parseVersion(out)
	if !ok {
		st := status("", githost.KindNotFound, "az did not report a version")
		st.Path = path
		return st
	}
	if !hasExt {
		st := status("", githost.KindNotFound, reasonExtension)
		st.Path, st.Version = path, version
		return st
	}
	st := status("", githost.KindOK, "")
	st.Path, st.Version = path, version
	return st
}

// parseVersion reads `az version -o json`: "<azure-cli> (azure-devops <extension>)".
func parseVersion(out []byte) (version string, hasExt, ok bool) {
	var v struct {
		AzureCLI   string            `json:"azure-cli"`
		Extensions map[string]string `json:"extensions"`
	}
	if json.Unmarshal(out, &v) != nil || v.AzureCLI == "" {
		return "", false, false
	}
	ext, hasExt := v.Extensions["azure-devops"]
	if !hasExt {
		return v.AzureCLI, false, true
	}
	return v.AzureCLI + " (azure-devops " + ext + ")", true, true
}

// loadDefaults reads and caches `az devops configure --list`.
func (d *Discovery) loadDefaults(ctx context.Context, path string) (Defaults, githost.Status) {
	d.mu.Lock()
	if e := d.defaults; e != nil && fresh(e.d.OrgURL != "", e.at, d.clock.Now()) {
		d.mu.Unlock()
		return e.d, githost.Status{Kind: githost.KindOK}
	}
	d.mu.Unlock()
	out, err := d.run(ctx, path, defaultsTimeout, []string{"devops", "configure", "--list", "--only-show-errors"})
	if err != nil {
		st := classify("", err, ctx.Err(), false)
		st.Path = path
		return Defaults{}, st
	}
	def := parseDefaults(string(out))
	if !errors.Is(ctx.Err(), context.Canceled) {
		d.mu.Lock()
		d.defaults = &defaultsEntry{d: def, at: d.clock.Now()}
		d.mu.Unlock()
	}
	return def, githost.Status{Kind: githost.KindOK}
}

// parseDefaults reads the [defaults] section: `organization = <url>`, `project = <name>`.
func parseDefaults(out string) Defaults {
	var def Defaults
	inDefaults := false
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "[") {
			inDefaults = line == "[defaults]"
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !inDefaults || !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "organization":
			if u, ok := normalizeOrgURL(val); ok {
				def.OrgURL = u
			}
		case "project":
			def.Project = strings.TrimSpace(val)
		}
	}
	return def
}

// Defaults is the configured default organization URL and project; both "" when unset.
func (d *Discovery) Defaults(ctx context.Context) (Defaults, githost.Status) {
	tool := d.az(ctx)
	if !tool.OK() {
		return Defaults{}, tool
	}
	return d.loadDefaults(ctx, tool.Path)
}

// account is the az login, best effort: a PAT sign-in has no az account.
func (d *Discovery) account(ctx context.Context, path string) string {
	out, err := d.run(ctx, path, accountTimeout, []string{"account", "show", "--query", "user.name", "-o", "tsv", "--only-show-errors"})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// run spawns az under its own deadline; an expired deadline (not the caller's) reports a timeoutError.
func (d *Discovery) run(ctx context.Context, path string, timeout time.Duration, args []string) ([]byte, error) {
	return runWithin(ctx, d.runner, path, timeout, args)
}

func runWithin(ctx context.Context, r Runner, path string, timeout time.Duration, args []string) ([]byte, error) {
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := r.Run(rctx, path, args)
	if ctx.Err() == nil && rctx.Err() != nil {
		return nil, timeoutError{after: timeout}
	}
	return out, err
}
