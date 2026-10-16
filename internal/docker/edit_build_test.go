package docker

import (
	"net/netip"
	"slices"
	"testing"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
)

const testID = "0123456789abcdef0123456789abcdef"

func baseInspect() container.InspectResponse {
	return container.InspectResponse{
		ID: testID, Name: "/web",
		Config: &container.Config{
			Hostname: testID[:12], Image: "img:1", Env: []string{"PATH=/bin", "A=1"}, Cmd: []string{"run"},
			Labels: map[string]string{"img": "yes", "own": "1"}, WorkingDir: "/app", User: "app",
			Volumes: map[string]struct{}{"/anon": {}}, ExposedPorts: network.PortSet{network.MustParsePort("80/tcp"): {}},
		},
		HostConfig: &container.HostConfig{
			Binds:        []string{"/host/a:/a:z", "vol1:/v"},
			Mounts:       []mount.Mount{{Type: mount.TypeVolume, Target: "/anon"}, {Type: mount.TypeTmpfs, Target: "/t"}},
			Links:        []string{"/db:/web/database"},
			PortBindings: network.PortMap{network.MustParsePort("80/tcp"): {{HostPort: "8080"}}},
			NetworkMode:  "appnet",
		},
		NetworkSettings: &container.NetworkSettings{Networks: map[string]*network.EndpointSettings{
			"appnet": {Aliases: []string{testID[:12], "web", "svc"}, IPAMConfig: &network.EndpointIPAMConfig{IPv4Address: netip.MustParseAddr("10.0.0.5")}},
			"other":  {Aliases: []string{testID[:12]}},
		}},
		Mounts: []container.MountPoint{
			{Type: mount.TypeVolume, Name: "anonvol", Destination: "/anon"},
			{Type: mount.TypeVolume, Name: "vol1", Destination: "/v"},
		},
	}
}

func TestSpecFromInspect(t *testing.T) {
	s := specFromInspect(baseInspect())
	if s.Recreate.Hostname != "" {
		t.Fatalf("hostname = %q, want empty for the short-ID default", s.Recreate.Hostname)
	}
	if got := s.InPlace.Networks[0]; got.Name != "appnet" || !slices.Equal(got.Aliases, []string{"svc"}) || got.IPv4 != "10.0.0.5" {
		t.Fatalf("appnet = %+v, want only the user alias and static address", got)
	}
	if len(s.AnonymousVolumes) != 1 || s.AnonymousVolumes[0].Name != "anonvol" {
		t.Fatalf("anonymous = %+v, want anonvol only", s.AnonymousVolumes)
	}
	if keys := []string{s.Recreate.Mounts[0].Key, s.Recreate.Mounts[1].Key}; !slices.Equal(keys, []string{"bind:0", "bind:1"}) {
		t.Fatalf("mount keys = %v", keys)
	}
	if s.Recreate.Mounts[1].Type != "volume" || s.Recreate.Mounts[0].Type != "bind" {
		t.Fatalf("mounts = %+v, want bind then volume", s.Recreate.Mounts)
	}
	if len(s.BaseHash) != 64 || s.BaseHash != specFromInspect(baseInspect()).BaseHash {
		t.Fatalf("hash %q not stable sha256", s.BaseHash)
	}
	if !slices.Contains(s.Preserved, "links") || !slices.Contains(s.Preserved, "network mode appnet") {
		t.Fatalf("preserved = %v, want links and network mode", s.Preserved)
	}
}

func TestBuildRecreate(t *testing.T) {
	old := &imageDefaults{
		Env: []string{"PATH=/bin"}, Cmd: []string{"run"}, Labels: map[string]string{"img": "yes"},
		Volumes: map[string]struct{}{"/anon": {}}, Exposed: map[string]struct{}{"80/tcp": {}}, WorkingDir: "/app", User: "app",
	}
	r := baseInspect()
	spec := specFromInspect(r)

	t.Run("same image keeps every default", func(t *testing.T) {
		b := buildRecreate(r, old, spec.InPlace, spec.Recreate)
		if !slices.Equal(b.Config.Env, []string{"PATH=/bin", "A=1"}) || b.Config.WorkingDir != "/app" || b.Config.Labels["img"] != "yes" {
			t.Fatalf("config = %+v, want inspected defaults kept", b.Config)
		}
	})

	t.Run("changed image drops old defaults, keeps overrides", func(t *testing.T) {
		rc := spec.Recreate
		rc.Image = "img:2"
		b := buildRecreate(r, old, spec.InPlace, rc)
		c := b.Config
		if !slices.Equal(c.Env, []string{"A=1"}) || c.Cmd != nil || c.WorkingDir != "" || c.User != "" || c.Labels["img"] != "" || c.Labels["own"] != "1" {
			t.Fatalf("config = %+v, want image defaults subtracted and own label kept", c)
		}
		if _, ok := c.Volumes["/anon"]; ok {
			t.Fatal("old image volume kept")
		}
		if _, ok := c.ExposedPorts[network.MustParsePort("80/tcp")]; !ok {
			t.Fatal("bound port must stay exposed")
		}
	})

	t.Run("mounts: unchanged verbatim, changed rebuilt, deleted dropped, unshown kept", func(t *testing.T) {
		rc := spec.Recreate
		rc.Mounts = []EditMount{rc.Mounts[0], {Key: "bind:1", Type: "volume", Source: "vol2", Target: "/v"}, {Type: "bind", Source: "/n", Target: "/n", ReadOnly: true}}
		b := buildRecreate(r, old, spec.InPlace, rc)
		if !slices.Equal(b.Host.Binds, []string{"/host/a:/a:z"}) {
			t.Fatalf("binds = %v, want the :z bind verbatim", b.Host.Binds)
		}
		want := []mount.Mount{
			{Type: mount.TypeVolume, Target: "/anon"}, {Type: mount.TypeTmpfs, Target: "/t"},
			{Type: mount.TypeVolume, Source: "vol2", Target: "/v"}, {Type: mount.TypeBind, Source: "/n", Target: "/n", ReadOnly: true},
		}
		if len(b.Host.Mounts) != len(want) {
			t.Fatalf("mounts = %+v, want %+v", b.Host.Mounts, want)
		}
		for i := range want {
			if b.Host.Mounts[i].Type != want[i].Type || b.Host.Mounts[i].Source != want[i].Source || b.Host.Mounts[i].Target != want[i].Target || b.Host.Mounts[i].ReadOnly != want[i].ReadOnly {
				t.Fatalf("mounts[%d] = %+v, want %+v", i, b.Host.Mounts[i], want[i])
			}
		}
	})

	t.Run("links normalised, hostname default dropped", func(t *testing.T) {
		b := buildRecreate(r, old, spec.InPlace, spec.Recreate)
		if !slices.Equal(b.Host.Links, []string{"db:database"}) || b.Config.Hostname != "" {
			t.Fatalf("links %v hostname %q, want db:database and empty", b.Host.Links, b.Config.Hostname)
		}
	})

	t.Run("primary network at create, others extra", func(t *testing.T) {
		b := buildRecreate(r, old, spec.InPlace, spec.Recreate)
		if b.Primary != "appnet" || b.Net == nil || b.Net.EndpointsConfig["appnet"].IPAMConfig == nil || len(b.Extra) != 1 || b.Extra["other"] == nil {
			t.Fatalf("build = primary %q net %+v extra %v", b.Primary, b.Net, b.Extra)
		}
		if got := b.Net.EndpointsConfig["appnet"].Aliases; !slices.Equal(got, []string{"svc"}) {
			t.Fatalf("aliases = %v", got)
		}
	})

	t.Run("host mode has no endpoints", func(t *testing.T) {
		h := baseInspect()
		h.HostConfig.NetworkMode = "host"
		h.NetworkSettings.Networks = map[string]*network.EndpointSettings{"host": {}}
		hs := specFromInspect(h)
		b := buildRecreate(h, old, hs.InPlace, hs.Recreate)
		if b.Net != nil || len(b.Extra) != 0 || b.Primary != "" {
			t.Fatalf("build = %+v, want no networking", b)
		}
	})
}
