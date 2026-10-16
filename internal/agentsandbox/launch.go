package agentsandbox

import (
	"path/filepath"
	"strings"
)

// Flags are the `claude` permission flags that back the profile on every platform: the CLI refuses
// early with a clear message, and on Linux they are the only layer.
func Flags(p Policy) (addDirs, disallowed []string) {
	addDirs = appendUnique(addDirs, p.Read...)
	addDirs = appendUnique(addDirs, p.Allow...)
	addDirs = appendUnique(addDirs, p.Scratch)
	if p.Access == AccessRead {
		disallowed = append(disallowed, "Edit", "Write", "NotebookEdit")
	} else {
		for _, r := range p.Read {
			disallowed = append(disallowed, "Edit(/"+filepath.ToSlash(r)+"/**)")
		}
	}
	for _, sub := range []string{"branch", "worktree", "checkout -b", "switch -c", "push", "fetch", "tag", "stash"} {
		disallowed = append(disallowed, "Bash(git "+sub+":*)")
	}
	if !p.Network {
		disallowed = append(disallowed, "WebFetch", "WebSearch")
	}
	return addDirs, disallowed
}

// Env is the sandboxed run's environment overrides. proxyURL is set when the network is off.
func Env(p Policy, proxyURL string) []string {
	cache := func(name string) string { return filepath.Join(p.Cache, name) }
	env := []string{
		"TMPDIR=" + filepath.Join(p.Scratch, "tmp"),
		"XDG_CACHE_HOME=" + cache("xdg"),
		"GOCACHE=" + cache("go-build"),
		"GOMODCACHE=" + cache("gomod"),
		"GOFLAGS=-modcacherw",
		"npm_config_cache=" + cache("npm"),
		"BUN_INSTALL_CACHE_DIR=" + cache("bun"),
		"PIP_CACHE_DIR=" + cache("pip"),
		"YARN_CACHE_FOLDER=" + cache("yarn"),
		"GIT_CONFIG_COUNT=2",
		"GIT_CONFIG_KEY_0=gc.auto", "GIT_CONFIG_VALUE_0=0",
		"GIT_CONFIG_KEY_1=maintenance.auto", "GIT_CONFIG_VALUE_1=false",
	}
	if p.Access == AccessRead {
		env = append(env, "GIT_OPTIONAL_LOCKS=0")
	}
	if proxyURL != "" {
		env = append(env, "HTTPS_PROXY="+proxyURL, "HTTP_PROXY="+proxyURL, "https_proxy="+proxyURL, "http_proxy="+proxyURL,
			"NO_PROXY=localhost,127.0.0.1,::1", "DISABLE_TELEMETRY=1", "DISABLE_ERROR_REPORTING=1",
			"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1")
	}
	return env
}

// MergeEnv appends overrides to environ, dropping what they replace and the SSH agent socket.
func MergeEnv(environ, overrides []string) []string {
	drop := map[string]bool{"SSH_AUTH_SOCK": true}
	for _, kv := range overrides {
		k, _, _ := strings.Cut(kv, "=")
		drop[k] = true
	}
	out := make([]string, 0, len(environ)+len(overrides))
	for _, kv := range environ {
		k, _, _ := strings.Cut(kv, "=")
		if !drop[k] {
			out = append(out, kv)
		}
	}
	return append(out, overrides...)
}
