package agentsandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/google/renameio/v2"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/toolexec"
)

func osGetenv(k string) string { return os.Getenv(k) }

// Prepare renders the profile and, on darwin, writes it and checks it compiles before claude
// starts, so a promised policy never silently drops.
func (s *system) Prepare(p Policy, rt Runtime) (Prepared, error) {
	pr, err := s.prepare(p, rt)
	if err != nil {
		s.Release(p.RunID)
	}
	return pr, err
}

func (s *system) prepare(p Policy, rt Runtime) (Prepared, error) {
	enforced := s.Support().Enforced
	proxyURL := ""
	if enforced && !p.Network {
		u, err := s.proxyURL(p.RunID)
		if err != nil {
			return Prepared{}, err
		}
		proxyURL = u
	}
	pr := Prepared{Profile: Profile(p, rt), Env: Env(p, proxyURL)}
	pr.AddDirs, pr.Disallowed = Flags(p)
	if !enforced {
		return pr, nil
	}
	if _, err := os.Stat(claudeheadless.DefaultSandboxBin); err != nil {
		return Prepared{}, ipcerr.T(ipcerr.CodeInternal, "backend.space.ade.sandbox.noSandboxExec.body", nil)
	}
	path := filepath.Join(p.Scratch, "profile.sb")
	if err := renameio.WriteFile(path, []byte(pr.Profile), 0o600); err != nil {
		return Prepared{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, claudeheadless.DefaultSandboxBin, "-f", path, "/usr/bin/true").CombinedOutput(); err != nil {
		return Prepared{}, ipcerr.T(ipcerr.CodeInternal, "backend.space.ade.sandbox.profileInvalid.body", map[string]string{"detail": toolexec.FirstLineBounded(string(out), 300)})
	}
	pr.ProfilePath = path
	pr.Exec = &claudeheadless.SandboxExec{Profile: path, Env: pr.Env, Unset: []string{"SSH_AUTH_SOCK"}}
	return pr, nil
}
