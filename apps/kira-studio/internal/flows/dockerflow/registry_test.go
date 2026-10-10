package dockerflow

import (
	"context"
	"testing"

	"github.com/moby/moby/client"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/docker"
)

func TestImageRegistryURL(t *testing.T) {
	app, d := boot(t)
	svc := app.W.Docker
	const hub = "https://hub.docker.com/_/alpine"

	id := sleeper(d, "reg", nil)
	// A local-only image: the containerd image store gives it a digest too, so the unknown host decides.
	ref := "localhost/" + d.Prefix() + "committed:latest"
	if _, err := d.Cli.ContainerCommit(context.Background(), id, client.ContainerCommitOptions{Reference: ref}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Cli.ImageRemove(context.Background(), ref, client.ImageRemoveOptions{}) })

	images, err := svc.Images()
	if err != nil {
		t.Fatal(err)
	}
	urls := map[string]string{}
	for _, img := range images {
		for _, tag := range img.Tags {
			urls[tag] = img.RegistryURL
		}
	}
	if got := urls[flowharness.Image]; got != hub {
		t.Fatalf("registry URL of %s = %q, want %q", flowharness.Image, got, hub)
	}
	if got, ok := urls[ref]; !ok || got != "" {
		t.Fatalf("registry URL of committed image %s = %q (listed %v), want empty", ref, got, ok)
	}

	var detail docker.ContainerDetail
	if detail, err = svc.InspectContainer(docker.IDArgs{ID: id}); err != nil {
		t.Fatal(err)
	}
	if detail.RegistryURL != hub {
		t.Fatalf("container registry URL = %q, want %q", detail.RegistryURL, hub)
	}
}
