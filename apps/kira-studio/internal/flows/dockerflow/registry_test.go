package dockerflow

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/moby/moby/client"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/docker"
)

// hubStub answers the Docker Hub repository API: 200 for repositories ending in "known", 404 otherwise.
type hubStub struct {
	mu   sync.Mutex
	hits map[string]int
}

func (h *hubStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.hits[r.URL.Path]++
	h.mu.Unlock()
	if strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "known") {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusNotFound)
}

func (h *hubStub) total() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, c := range h.hits {
		n += c
	}
	return n
}

func imageIDOf(t *testing.T, svc interface {
	Images() ([]docker.Image, error)
}, tag string) string {
	t.Helper()
	images, err := svc.Images()
	if err != nil {
		t.Fatal(err)
	}
	for _, img := range images {
		for _, tg := range img.Tags {
			if tg == tag {
				return img.ID
			}
		}
	}
	t.Fatalf("image %s not listed", tag)
	return ""
}

func TestImageRegistryURL(t *testing.T) {
	d := flowharness.RequireDocker(t)
	stub := &hubStub{hits: map[string]int{}}
	srv := httptest.NewServer(stub)
	t.Cleanup(srv.Close)
	app := flowharness.New(t, flowharness.WithDockerHubAPI(srv.URL))
	svc := app.W.Docker
	ctx := context.Background()

	info, err := d.Cli.Info(ctx, client.InfoOptions{})
	if err != nil {
		t.Fatal(err)
	}
	containerd := false
	for _, kv := range info.Info.DriverStatus {
		containerd = containerd || (kv[0] == "driver-type" && kv[1] == "io.containerd.snapshotter.v1")
	}

	id := sleeper(d, "reg", nil)
	// Implied Docker Hub names: the containerd store gives both a digest, only Hub's verdict tells them apart.
	local := d.Prefix() + "committed:latest"
	known := d.Prefix() + "known:latest"
	for _, ref := range []string{local, known} {
		if _, err := d.Cli.ContainerCommit(ctx, id, client.ContainerCommitOptions{Reference: ref}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = d.Cli.ImageRemove(context.Background(), ref, client.ImageRemoveOptions{}) })
	}
	opts := []flowharness.ContractOption{
		flowharness.Replace(d.Prefix(), "kira-flow-"),
		flowharness.Replace(runIDOf(d), "run"),
	}

	got, err := svc.ImageRegistry(docker.IDArgs{ID: imageIDOf(t, svc, local)})
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "docker-registry", "DockerService.ImageRegistry#local", got, opts...)
	if got.URL != "" {
		t.Fatalf("registry URL of unpublished %s = %q, want empty", local, got.URL)
	}

	// An explicit registry host names the registry itself: linked without asking Hub.
	before := stub.total()
	got, err = svc.ImageRegistry(docker.IDArgs{ID: imageIDOf(t, svc, flowharness.Image)})
	if err != nil {
		t.Fatal(err)
	}
	if got.URL != "https://hub.docker.com/_/alpine" {
		t.Fatalf("registry URL of %s = %q, want the Hub page", flowharness.Image, got.URL)
	}
	if stub.total() != before {
		t.Fatalf("explicit-host image called the Hub API %d times", stub.total()-before)
	}

	if !containerd {
		return
	}
	knownID := imageIDOf(t, svc, known)
	for range 2 {
		if got, err = svc.ImageRegistry(docker.IDArgs{ID: knownID}); err != nil {
			t.Fatal(err)
		}
	}
	app.Contract(t, "docker-registry", "DockerService.ImageRegistry#hub", got, opts...)
	if want := "https://hub.docker.com/_/" + d.Prefix() + "known"; got.URL != want {
		t.Fatalf("registry URL of confirmed %s = %q, want %q", known, got.URL, want)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if n := stub.hits["/v2/repositories/library/"+d.Prefix()+"known/"]; n != 1 {
		t.Fatalf("Hub verdict for %s fetched %d times, want 1 (cached)", known, n)
	}
}
