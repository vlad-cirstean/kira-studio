package claude

import (
	"net/url"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/internal/harness"
)

var (
	configFiles   = []string{"settings.json", "settings.local.json", "CLAUDE.md", "keybindings.json"}
	extensionDirs = []string{"commands", "agents", "skills", "plugins", "hooks", "output-styles"}
)

// SandboxNeeds: the install tree is two levels above bin/claude for an npm-style install, else the
// binary's folder. Hooks in ~/.claude run unsandboxed, so its config and extension dirs are protected.
func (*Provider) SandboxNeeds(home, bin string) harness.SandboxNeeds {
	n := harness.SandboxNeeds{QuietEnv: []string{
		"DISABLE_TELEMETRY=1", "DISABLE_ERROR_REPORTING=1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
	}}
	if bin != "" {
		dir := filepath.Dir(bin)
		n.InstallPrefix = dir
		if filepath.Base(dir) == "bin" {
			n.InstallPrefix = filepath.Dir(dir)
		}
	}
	if home == "" {
		return n
	}
	n.ConfigDirs = []string{filepath.Join(home, ".claude")}
	n.ConfigFiles = []string{filepath.Join(home, ".claude.json")}
	n.ProtectFiles = configFiles
	n.ProtectDirs = extensionDirs
	return n
}

// SandboxDenies refuses edits when the run is read-only, else edits under the read-only dirs, plus
// the git commands that change refs, and the web tools when the network is off.
func (*Provider) SandboxDenies(readOnly bool, readDirs []string, network bool) []string {
	var out []string
	if readOnly {
		out = append(out, "Edit", "Write", "NotebookEdit")
	} else {
		for _, r := range readDirs {
			out = append(out, "Edit(/"+filepath.ToSlash(r)+"/**)")
		}
	}
	for _, sub := range []string{"branch", "worktree", "checkout -b", "switch -c", "push", "fetch", "tag", "stash"} {
		out = append(out, "Bash(git "+sub+":*)")
	}
	if !network {
		out = append(out, "WebFetch", "WebSearch")
	}
	return out
}

// APIHosts is anthropic.com, claude.ai and claude.com with their subdomains, the hosts of the
// base-URL variables, and the cloud providers' suffixes when the matching CLAUDE_CODE_USE_* switch
// is on.
func (*Provider) APIHosts(getenv func(string) string) (exact, suffixes []string) {
	for _, k := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL"} {
		if u, err := url.Parse(getenv(k)); err == nil && u.Hostname() != "" {
			exact = append(exact, strings.ToLower(u.Hostname()))
		}
	}
	suffixes = []string{"anthropic.com", "claude.ai", "claude.com"}
	if getenv("CLAUDE_CODE_USE_BEDROCK") == "1" {
		suffixes = append(suffixes, "amazonaws.com")
	}
	if getenv("CLAUDE_CODE_USE_VERTEX") == "1" {
		suffixes = append(suffixes, "googleapis.com")
	}
	return exact, suffixes
}
