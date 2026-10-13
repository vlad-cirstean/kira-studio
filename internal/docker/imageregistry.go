package docker

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
)

// DefaultHubAPI is the Docker Hub web API a containerd-store image's implied repository is checked against.
const DefaultHubAPI = "https://hub.docker.com"

const (
	hubTimeout      = 5 * time.Second
	containerdStore = "io.containerd.snapshotter.v1"
)

// RegistryLink is the registry web page of one image; URL is empty when none is known.
type RegistryLink struct {
	URL string `json:"url"`
}

// hubCache remembers Hub verdicts per repository path. Errors are never stored.
type hubCache struct {
	mu      sync.Mutex
	verdict map[string]bool
}

func (c *hubCache) get(path string) (ok, found bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ok, found = c.verdict[path]
	return ok, found
}

func (c *hubCache) set(path string, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.verdict == nil {
		c.verdict = map[string]bool{}
	}
	c.verdict[path] = ok
}

// usesContainerdStore reads the engine's image store type once per client.
func (m *Manager) usesContainerdStore(ctx context.Context, cli *client.Client) (bool, error) {
	m.mu.Lock()
	if m.containerd != nil {
		v := *m.containerd
		m.mu.Unlock()
		return v, nil
	}
	m.mu.Unlock()
	info, err := cli.Info(ctx, client.InfoOptions{})
	if err != nil {
		return false, err
	}
	v := false
	for _, kv := range info.Info.DriverStatus {
		if kv[0] == "driver-type" && kv[1] == containerdStore {
			v = true
		}
	}
	m.mu.Lock()
	m.containerd = &v
	m.mu.Unlock()
	return v, nil
}

// hubHasRepo asks the Hub API whether repoPath ("ns/repo") exists. Only 200 and 404 are verdicts.
func (m *Manager) hubHasRepo(ctx context.Context, repoPath string) (bool, error) {
	if ok, found := m.hub.get(repoPath); found {
		return ok, nil
	}
	ctx, cancel := context.WithTimeout(ctx, hubTimeout)
	defer cancel()
	base := strings.TrimRight(m.HubAPI, "/")
	ns, repo, _ := strings.Cut(repoPath, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v2/repositories/"+url.PathEscape(ns)+"/"+url.PathEscape(repo)+"/", nil)
	if err != nil {
		return false, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
		m.hub.set(repoPath, true)
		return true, nil
	case http.StatusNotFound:
		m.hub.set(repoPath, false)
		return false, nil
	}
	return false, nil
}

// imageRegistry resolves one image's registry page. Hub failures mean "no link", never an error.
func (m *Manager) imageRegistry(ctx context.Context, id string) (RegistryLink, error) {
	var out RegistryLink
	err := m.call(ctx, callTimeout, func(ctx context.Context, cli *client.Client) error {
		ii, err := cli.ImageInspect(ctx, id)
		if err != nil {
			return err
		}
		containerd, err := m.usesContainerdStore(ctx, cli)
		if err != nil {
			return err
		}
		out.URL, _ = registryLink(containerd, ii.RepoTags, ii.RepoDigests, func(p string) (bool, error) {
			return m.hubHasRepo(ctx, p)
		})
		return nil
	})
	return out, err
}
