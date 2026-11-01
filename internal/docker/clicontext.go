package docker

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

const contextShowTimeout = 3 * time.Second

// cliContext asks the docker CLI for its current context instead of reading the docker config file, which can
// hold registry credentials. The answer is cached until forget.
type cliContext struct {
	home     string
	lookPath func(string) (string, error)
	run      func(ctx context.Context, path string, args []string) ([]byte, error)

	mu    sync.Mutex
	known bool
	value string
}

func (c *cliContext) name() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.known {
		c.value, c.known = c.query(), true
	}
	return c.value
}

func (c *cliContext) forget() {
	c.mu.Lock()
	c.known = false
	c.mu.Unlock()
}

func (c *cliContext) query() string {
	look := c.lookPath
	if look == nil {
		look = exec.LookPath
	}
	path, _, found := toolexec.Locate(look, os.Stat, "docker", c.candidates())
	if !found {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), contextShowTimeout)
	defer cancel()
	run := c.run
	if run == nil {
		run = func(ctx context.Context, path string, args []string) ([]byte, error) {
			return toolexec.RunIO(ctx, path, args, "", os.Environ(), nil)
		}
	}
	out, err := run(ctx, path, []string{"context", "show"})
	if err != nil {
		return ""
	}
	v := strings.TrimSpace(string(out))
	if strings.Contains(v, "\n") {
		return ""
	}
	return v
}

func (c *cliContext) candidates() []string {
	list := []string{
		"/usr/local/bin/docker",
		"/opt/homebrew/bin/docker",
		"/usr/bin/docker",
		"/Applications/Docker.app/Contents/Resources/bin/docker",
	}
	if c.home != "" {
		for _, d := range []string{".docker", ".orbstack", ".rd"} {
			list = append(list, filepath.Join(c.home, d, "bin", "docker"))
		}
	}
	return list
}
