package docker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type fixture struct {
	t    *testing.T
	home string
	env  map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	return &fixture{t: t, home: t.TempDir(), env: map[string]string{}}
}

func (f *fixture) resolveEnv() resolveEnv {
	return resolveEnv{Getenv: func(k string) string { return f.env[k] }, Home: f.home, Stat: os.Stat}
}

func (f *fixture) write(path string, data []byte) {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) context(name, host string, skipVerify bool) {
	meta, _ := json.Marshal(map[string]any{
		"Name":      name,
		"Metadata":  map[string]string{"Description": name + " desc"},
		"Endpoints": map[string]any{"docker": map[string]any{"Host": host, "SkipTLSVerify": skipVerify}},
	})
	f.write(filepath.Join(f.home, ".docker", "contexts", "meta", contextHash(name), "meta.json"), meta)
}

func (f *fixture) current(name string) {
	f.write(filepath.Join(f.home, ".docker", "config.json"), []byte(`{"currentContext":"`+name+`"}`))
}

func TestResolveEndpointPrecedence(t *testing.T) {
	f := newFixture(t)
	f.context("colima", "unix:///colima.sock", false)
	f.context("other", "unix:///other.sock", false)
	f.current("colima")

	tests := []struct {
		name       string
		env        map[string]string
		selected   string
		wantHost   string
		wantSource string
	}{
		{"selected beats everything", map[string]string{"DOCKER_HOST": "unix:///env.sock", "DOCKER_CONTEXT": "colima"}, "other", "unix:///other.sock", sourceSelected},
		{"DOCKER_HOST beats contexts", map[string]string{"DOCKER_HOST": "unix:///env.sock", "DOCKER_CONTEXT": "other"}, "", "unix:///env.sock", sourceEnv},
		{"DOCKER_CONTEXT beats config", map[string]string{"DOCKER_CONTEXT": "other"}, "", "unix:///other.sock", sourceContext},
		{"currentContext", nil, "", "unix:///colima.sock", sourceContext},
		{"selected default skips currentContext", nil, defaultContext, defaultSocket, sourceSelected},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f.env = tc.env
			if f.env == nil {
				f.env = map[string]string{}
			}
			ep, _, err := resolveEndpoint(f.resolveEnv(), tc.selected)
			if err != nil {
				t.Fatal(err)
			}
			if ep.Host != tc.wantHost || ep.Source != tc.wantSource {
				t.Fatalf("got %s (%s), want %s (%s)", ep.Host, ep.Source, tc.wantHost, tc.wantSource)
			}
		})
	}
}

func TestResolveEndpointDefaultAndProbe(t *testing.T) {
	f := newFixture(t)
	sock := filepath.Join(f.home, ".colima", "default", "docker.sock")
	f.write(sock, nil)

	statNoDefault := func(p string) (os.FileInfo, error) {
		if p == "/var/run/docker.sock" {
			return nil, os.ErrNotExist
		}
		return os.Stat(p)
	}
	env := f.resolveEnv()
	env.Stat = statNoDefault
	ep, _, err := resolveEndpoint(env, "")
	if err != nil {
		t.Fatal(err)
	}
	if ep.Host != "unix://"+sock || ep.Source != sourceProbe {
		t.Fatalf("probe: got %s (%s)", ep.Host, ep.Source)
	}

	env.Stat = func(p string) (os.FileInfo, error) { return os.Stat(p + ".absent") }
	ep, _, err = resolveEndpoint(env, "")
	if err != nil {
		t.Fatal(err)
	}
	if ep.Host != defaultSocket || ep.Source != sourceDefault {
		t.Fatalf("default: got %s (%s)", ep.Host, ep.Source)
	}
}

func TestResolveEndpointRemote(t *testing.T) {
	f := newFixture(t)

	f.env["DOCKER_HOST"] = "tcp://10.0.0.5:2375"
	ep, _, err := resolveEndpoint(f.resolveEnv(), "")
	if err != nil {
		t.Fatal(err)
	}
	if ep.Secure || !ep.Remote {
		t.Fatalf("plain tcp must be insecure remote: %+v", ep)
	}

	f.env["DOCKER_HOST"] = "ssh://user@example.com"
	ep, opts, err := resolveEndpoint(f.resolveEnv(), "")
	if err != nil {
		t.Fatal(err)
	}
	if !ep.Secure || !ep.Remote || len(opts) != 2 {
		t.Fatalf("ssh must route through the connection helper (host + dialer): %+v, %d opts", ep, len(opts))
	}

	f.env["DOCKER_HOST"] = "ssh://"
	if _, _, err := resolveEndpoint(f.resolveEnv(), ""); err == nil {
		t.Fatal("ssh host without a hostname must fail")
	}
}

func TestResolveEndpointTLSMaterial(t *testing.T) {
	f := newFixture(t)
	f.context("remote", "tcp://10.0.0.5:2376", false)
	tlsDir := filepath.Join(f.home, ".docker", "contexts", "tls", contextHash("remote"), "docker")
	f.write(filepath.Join(tlsDir, "ca.pem"), []byte("not a pem"))

	_, _, err := resolveEndpoint(f.resolveEnv(), "remote")
	if err == nil {
		t.Fatal("context TLS material that is not a certificate must fail")
	}

	certDir := t.TempDir()
	f.write(filepath.Join(certDir, "ca.pem"), []byte("not a pem"))
	f.env["DOCKER_HOST"] = "tcp://10.0.0.5:2376"
	f.env["DOCKER_CERT_PATH"] = certDir
	f.env["DOCKER_TLS_VERIFY"] = "1"
	if _, _, err := resolveEndpoint(f.resolveEnv(), ""); err == nil {
		t.Fatal("DOCKER_CERT_PATH material that is not a certificate must fail")
	}
}

func TestResolveEndpointBrokenContext(t *testing.T) {
	f := newFixture(t)
	if _, _, err := resolveEndpoint(f.resolveEnv(), "missing"); err == nil {
		t.Fatal("missing context must fail")
	}
	f.write(filepath.Join(f.home, ".docker", "contexts", "meta", contextHash("bad"), "meta.json"), []byte("{oops"))
	if _, _, err := resolveEndpoint(f.resolveEnv(), "bad"); err == nil {
		t.Fatal("corrupt meta.json must fail")
	}
}

func TestListContexts(t *testing.T) {
	f := newFixture(t)
	f.context("b", "unix:///b.sock", false)
	f.context("a", "unix:///a.sock", false)
	f.current("b")
	got, err := listContexts(f.resolveEnv(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Name != defaultContext || got[1].Name != "a" || got[2].Name != "b" || !got[2].Current || got[0].Current {
		t.Fatalf("unexpected list: %+v", got)
	}
}
