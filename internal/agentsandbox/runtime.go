package agentsandbox

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// Runtime is what the sandboxed `claude` and its tools need from the machine.
type Runtime struct {
	Home string
	// ClaudePrefix is the install tree of the resolved claude binary.
	ClaudePrefix string
	// PathPrefixes are read-only toolchain trees under Home, taken from the login shell's PATH.
	PathPrefixes []string
	// UserTemp and UserCache are darwin's per-user temp and cache dirs; frameworks write there
	// regardless of TMPDIR.
	UserTemp, UserCache string
	SSHAuthSock         string
}

var (
	rtMu  sync.Mutex
	rtVal *Runtime
)

const discoverTimeout = 20 * time.Second

// DiscoverRuntime probes once per app session. The probe is detached from the caller's context, so
// one stopped run cannot shrink the set for the rest of the session. A probe that finds no claude is
// not cached; the next launch retries.
func DiscoverRuntime(_ context.Context, claudeBin string) Runtime {
	rtMu.Lock()
	defer rtMu.Unlock()
	if rtVal != nil {
		return *rtVal
	}
	ctx, cancel := context.WithTimeout(context.Background(), discoverTimeout)
	defer cancel()
	rt := discover(ctx, claudeBin)
	if rt.ClaudePrefix != "" {
		rtVal = &rt
	}
	return rt
}

func discover(ctx context.Context, claudeBin string) Runtime {
	rt := Runtime{SSHAuthSock: os.Getenv("SSH_AUTH_SOCK")}
	if h, err := os.UserHomeDir(); err == nil {
		rt.Home = realPath(h)
	} else {
		slog.Warn("sandbox: no home dir", "scope", "agentsandbox", "err", err)
	}
	if bin, _, err := toolexec.ResolveClaude(ctx, toolexec.ClaudeDeps{Bin: claudeBin}); err == nil {
		rt.ClaudePrefix = claudePrefix(realPath(bin))
	} else {
		slog.Warn("sandbox: claude not resolved", "scope", "agentsandbox", "err", err)
	}
	rt.PathPrefixes = shellPathPrefixes(ctx, rt.Home)
	rt.UserTemp = getconf(ctx, "DARWIN_USER_TEMP_DIR")
	rt.UserCache = getconf(ctx, "DARWIN_USER_CACHE_DIR")
	return rt
}

func realPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return p
}

// claudePrefix is two levels above bin/claude for an npm-style install, else the binary's folder.
func claudePrefix(bin string) string {
	dir := filepath.Dir(bin)
	if filepath.Base(dir) == "bin" {
		return filepath.Dir(dir)
	}
	return dir
}

func shellPathPrefixes(ctx context.Context, home string) []string {
	shell := os.Getenv("SHELL")
	if !filepath.IsAbs(shell) || home == "" {
		return nil
	}
	sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := toolexec.RunIO(sctx, shell, []string{"-l", "-i", "-c", `printf %s "$PATH"`}, "", os.Environ(), nil)
	if err != nil {
		slog.Warn("sandbox: login shell PATH probe failed", "scope", "agentsandbox", "err", err)
		return nil
	}
	return PathPrefixes(string(out), home)
}

// PathPrefixes keeps each PATH entry under home as its parent (the toolchain root), or the entry
// itself when the parent is home.
func PathPrefixes(pathVar, home string) []string {
	var out []string
	for _, e := range filepath.SplitList(strings.TrimSpace(pathVar)) {
		if !filepath.IsAbs(e) {
			continue
		}
		e = realPath(e)
		if !strings.HasPrefix(e, home+string(filepath.Separator)) {
			continue
		}
		prefix := filepath.Dir(e)
		if prefix == home {
			prefix = e
		}
		out = appendUnique(out, prefix)
	}
	return out
}

func getconf(ctx context.Context, name string) string {
	gctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(gctx, "getconf", name).Output()
	if err != nil {
		return ""
	}
	return realPath(strings.TrimRight(strings.TrimSpace(string(out)), "/"))
}
