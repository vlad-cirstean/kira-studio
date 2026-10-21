//go:build darwin

package agentsandbox

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// enforceEnv is a fake home with a repo, a linked worktree on branch task/a and a second branch.
type enforceEnv struct {
	home, repo, wt string
	pol            Policy
	rt             Runtime
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func newEnforceEnv(t *testing.T) *enforceEnv {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e := &enforceEnv{home: filepath.Join(root, "home"), repo: filepath.Join(root, "repo"), wt: filepath.Join(root, "wt")}
	mustMkdir(t, e.home, e.repo, filepath.Join(e.home, "specs"))
	mustWrite(t, filepath.Join(e.home, "secret.txt"), "s")
	mustWrite(t, filepath.Join(e.home, "specs", "a.md"), "spec")
	gitIn(t, e.repo, "init", "-q", "-b", "main")
	mustWrite(t, filepath.Join(e.repo, "f.txt"), "1")
	gitIn(t, e.repo, "add", ".")
	gitIn(t, e.repo, "commit", "-q", "-m", "init")
	gitIn(t, e.repo, "branch", "other")
	gitIn(t, e.repo, "worktree", "add", "-q", "-b", "task/a", e.wt)
	in := Input{
		RunID: "r1", Access: AccessWrite, Worktrees: []string{e.wt}, Read: []string{filepath.Join(e.home, "specs")}, Network: true,
		Scratch: filepath.Join(root, "scratch"), Cache: filepath.Join(root, "cache"), Branch: map[string]string{e.wt: "task/a"},
	}
	e.rt = testRuntime(e.home)
	e.rt.UserTemp = filepath.Join(root, "usertemp")
	mustMkdir(t, e.rt.UserTemp)
	e.pol, _, err = ResolvePolicy(in, e.rt)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// sh runs script under the profile and returns its combined output and exit error.
func (e *enforceEnv) sh(t *testing.T, script string) (string, error) {
	t.Helper()
	profile := filepath.Join(e.pol.Scratch, "profile.sb")
	mustWrite(t, profile, Profile(e.pol, e.rt))
	cmd := exec.Command("/usr/bin/sandbox-exec", "-f", profile, "/bin/sh", "-c", script)
	cmd.Dir = e.pol.RunDir
	cmd.Env = append(MergeEnv(os.Environ(), Env(e.pol, e.rt, "")), "HOME="+e.home)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (e *enforceEnv) mustPass(t *testing.T, script string) {
	t.Helper()
	if out, err := e.sh(t, script); err != nil {
		t.Fatalf("%s: %v\n%s", script, err, out)
	}
}

func (e *enforceEnv) mustDeny(t *testing.T, script string) {
	t.Helper()
	if out, err := e.sh(t, script); err == nil {
		t.Fatalf("%s: want denied, got success\n%s", script, out)
	}
}

func TestEnforceWriteAccess(t *testing.T) {
	e := newEnforceEnv(t)
	e.mustPass(t, "echo hi > a.txt && git add a.txt && git -c user.name=t -c user.email=t@t commit -q -m c && git -c user.name=t -c user.email=t@t commit -q --amend -m c2")
	e.mustPass(t, "echo x > $TMPDIR/t.txt")
	e.mustDeny(t, "echo x > "+filepath.Join(e.repo, "outside.txt"))
	e.mustDeny(t, "echo x > "+filepath.Join(e.home, "new.txt"))
	e.mustDeny(t, "cat "+filepath.Join(e.home, "secret.txt"))
	e.mustPass(t, "cat "+filepath.Join(e.home, "specs", "a.md"))
	e.mustDeny(t, "echo x > "+filepath.Join(e.home, "specs", "b.md"))
	for _, script := range []string{
		"git branch x",
		"git checkout -q -b y",
		"git worktree add -q ../wt2",
		"git update-ref refs/heads/main HEAD",
		"git update-ref refs/heads/other HEAD",
		"git tag v1",
		"git stash -q -u",
		"git config core.bare false",
		"echo x >> " + filepath.Join(e.repo, ".git", "hooks", "pre-commit"),
		"echo x > .git",
	} {
		e.mustDeny(t, script)
	}
	e.mustDeny(t, "f=$(find "+filepath.Join(e.repo, ".git", "objects")+" -type f -path '*/??/*' | head -1); rm -f \"$f\"; test ! -e \"$f\"")
}

func TestEnforceReadAccess(t *testing.T) {
	e := newEnforceEnv(t)
	e.pol.Access = AccessRead
	e.pol.Read = append(e.pol.Read, e.pol.Write...)
	e.pol.Write = nil
	e.mustDeny(t, "echo x > a.txt")
	e.mustPass(t, "cat f.txt && echo x > $TMPDIR/s.txt && git status --short >/dev/null")
}

func TestEnforceNetworkOff(t *testing.T) {
	e := newEnforceEnv(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	e.pol.Network = false
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	e.mustPass(t, "/usr/bin/nc -z 127.0.0.1 "+port)
	e.mustDeny(t, "/usr/bin/nc -z -w 3 1.1.1.1 443")
}

func TestEnforceWatcher(t *testing.T) {
	e := newEnforceEnv(t)
	profile := filepath.Join(e.pol.Scratch, "profile.sb")
	mustWrite(t, profile, Profile(e.pol, e.rt))
	s := newSystem("darwin")
	got := make(chan Denial, 8)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/sandbox-exec", "-f", profile, "/bin/sh", "-c", "sleep 2; git branch x; sleep 1")
	cmd.Dir = e.pol.RunDir
	cmd.Env = append(MergeEnv(os.Environ(), Env(e.pol, e.rt, "")), "HOME="+e.home)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	stop := s.Watch(cmd.Process.Pid, "r1", func(d Denial) { got <- d })
	defer stop()
	_ = cmd.Wait()
	select {
	case d := <-got:
		if !strings.Contains(d.Target, "refs/heads/x") {
			t.Fatalf("unexpected denial %+v", d)
		}
	case <-time.After(5 * time.Second):
		t.Skip("no denial in the unified log within 5 s; `log stream` may need an admin user")
	}
}
