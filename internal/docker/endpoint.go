package docker

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/docker/cli/cli/connhelper"
	"github.com/moby/moby/client"
)

// Endpoint source values.
const (
	sourceSelected = "selected"
	sourceEnv      = "env"
	sourceContext  = "context"
	sourceDefault  = "default"
	sourceProbe    = "probe"
)

const (
	defaultContext = "default"
	defaultSocket  = "unix:///var/run/docker.sock"
)

// Endpoint is the engine address a client dials and how it was found.
type Endpoint struct {
	Context string `json:"context"`
	Host    string `json:"host"`
	Source  string `json:"source"`
	Secure  bool   `json:"secure"`
	Remote  bool   `json:"remote"`
}

// ContextInfo is one docker context.
type ContextInfo struct {
	Name        string `json:"name"`
	Host        string `json:"host"`
	Description string `json:"description"`
	Current     bool   `json:"current"`
}

// resolveEnv is the process state endpoint resolution reads; a seam for tests.
type resolveEnv struct {
	Getenv func(string) string
	Home   string
	Stat   func(string) (os.FileInfo, error)
}

func osResolveEnv() resolveEnv {
	home, _ := os.UserHomeDir()
	return resolveEnv{Getenv: os.Getenv, Home: home, Stat: os.Stat}
}

func (e resolveEnv) exists(path string) bool {
	_, err := e.Stat(path)
	return err == nil
}

func (e resolveEnv) configDir() string {
	if d := e.Getenv("DOCKER_CONFIG"); d != "" {
		return d
	}
	return filepath.Join(e.Home, ".docker")
}

type contextMeta struct {
	Name     string `json:"Name"`
	Metadata struct {
		Description string `json:"Description"`
	} `json:"Metadata"`
	Endpoints map[string]struct {
		Host          string `json:"Host"`
		SkipTLSVerify bool   `json:"SkipTLSVerify"`
	} `json:"Endpoints"`
}

func contextHash(name string) string {
	sum := sha256.Sum256([]byte(name))
	return hex.EncodeToString(sum[:])
}

func (e resolveEnv) readContext(name string) (contextMeta, error) {
	path := filepath.Join(e.configDir(), "contexts", "meta", contextHash(name), "meta.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return contextMeta{}, fmt.Errorf("docker context %q not found", name)
		}
		return contextMeta{}, fmt.Errorf("read docker context %q: %w", name, err)
	}
	var m contextMeta
	if err := json.Unmarshal(raw, &m); err != nil {
		return contextMeta{}, fmt.Errorf("docker context %q has invalid meta.json: %w", name, err)
	}
	if ep, ok := m.Endpoints["docker"]; !ok || ep.Host == "" {
		return contextMeta{}, fmt.Errorf("docker context %q has no docker endpoint", name)
	}
	return m, nil
}

func (e resolveEnv) currentContextName() string {
	if c := e.Getenv("DOCKER_CONTEXT"); c != "" {
		return c
	}
	raw, err := os.ReadFile(filepath.Join(e.configDir(), "config.json"))
	if err != nil {
		return ""
	}
	var cfg struct {
		CurrentContext string `json:"currentContext"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return ""
	}
	return cfg.CurrentContext
}

// tlsFiles are the three PEM paths of one TLS material directory.
type tlsFiles struct{ ca, cert, key string }

func (t tlsFiles) any() bool { return t.ca != "" || t.cert != "" || t.key != "" }

func contextTLS(e resolveEnv, name string) tlsFiles {
	dir := filepath.Join(e.configDir(), "contexts", "tls", contextHash(name), "docker")
	var t tlsFiles
	for _, f := range []struct {
		dst  *string
		name string
	}{{&t.ca, "ca.pem"}, {&t.cert, "cert.pem"}, {&t.key, "key.pem"}} {
		if p := filepath.Join(dir, f.name); e.exists(p) {
			*f.dst = p
		}
	}
	return t
}

func envTLS(e resolveEnv) tlsFiles {
	dir := e.Getenv("DOCKER_CERT_PATH")
	if dir == "" {
		return tlsFiles{}
	}
	return tlsFiles{ca: filepath.Join(dir, "ca.pem"), cert: filepath.Join(dir, "cert.pem"), key: filepath.Join(dir, "key.pem")}
}

func buildTLS(t tlsFiles, skipVerify bool) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: skipVerify} //nolint:gosec // user-chosen via context SkipTLSVerify / unset DOCKER_TLS_VERIFY
	if t.ca != "" {
		pem, err := os.ReadFile(t.ca)
		if err != nil {
			return nil, fmt.Errorf("read TLS CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("TLS CA %s holds no certificate", t.ca)
		}
		cfg.RootCAs = pool
	}
	if t.cert != "" || t.key != "" {
		pair, err := tls.LoadX509KeyPair(t.cert, t.key)
		if err != nil {
			return nil, fmt.Errorf("load TLS client certificate: %w", err)
		}
		cfg.Certificates = []tls.Certificate{pair}
	}
	return cfg, nil
}

// hostOpts turns one host string into client options plus the Endpoint facts it implies.
func hostOpts(host string, files tlsFiles, tlsWanted, skipVerify bool) (Endpoint, []client.Opt, error) {
	u, err := url.Parse(host)
	if err != nil || u.Scheme == "" {
		return Endpoint{}, nil, fmt.Errorf("invalid docker host %q", host)
	}
	ep := Endpoint{Host: host, Secure: true}
	switch u.Scheme {
	case "unix", "npipe":
		return ep, []client.Opt{client.WithHost(host)}, nil
	case "ssh":
		helper, err := connhelper.GetConnectionHelper(host)
		if err != nil {
			return Endpoint{}, nil, err
		}
		ep.Remote = true
		return ep, []client.Opt{client.WithHost(helper.Host), client.WithDialContext(helper.Dialer)}, nil
	case "tcp", "http", "https":
		ep.Remote = true
		if files.any() || tlsWanted || u.Scheme == "https" {
			cfg, err := buildTLS(files, skipVerify)
			if err != nil {
				return Endpoint{}, nil, err
			}
			hc := &http.Client{Transport: &http.Transport{TLSClientConfig: cfg}, CheckRedirect: client.CheckRedirect}
			return ep, []client.Opt{client.WithHTTPClient(hc), client.WithHost(host)}, nil
		}
		ep.Secure = false
		return ep, []client.Opt{client.WithHost(host)}, nil
	default:
		return Endpoint{}, nil, fmt.Errorf("unsupported docker host scheme %q", u.Scheme)
	}
}

func fromContext(e resolveEnv, name, source string) (Endpoint, []client.Opt, error) {
	meta, err := e.readContext(name)
	if err != nil {
		return Endpoint{}, nil, err
	}
	dep := meta.Endpoints["docker"]
	ep, opts, err := hostOpts(dep.Host, contextTLS(e, name), false, dep.SkipTLSVerify)
	if err != nil {
		return Endpoint{}, nil, fmt.Errorf("docker context %q: %w", name, err)
	}
	ep.Context, ep.Source = name, source
	return ep, opts, nil
}

func fromEnvHost(e resolveEnv) (Endpoint, []client.Opt, error) {
	host := e.Getenv("DOCKER_HOST")
	verify := e.Getenv("DOCKER_TLS_VERIFY") != ""
	ep, opts, err := hostOpts(host, envTLS(e), verify, !verify && envTLS(e).any())
	if err != nil {
		return Endpoint{}, nil, fmt.Errorf("DOCKER_HOST: %w", err)
	}
	ep.Context, ep.Source = defaultContext, sourceEnv
	return ep, opts, nil
}

// resolveEndpoint follows the docker CLI order: UI-selected context, DOCKER_HOST, DOCKER_CONTEXT
// or config currentContext, the default socket, then well-known per-tool sockets.
func resolveEndpoint(e resolveEnv, selected string) (Endpoint, []client.Opt, error) {
	if selected != "" && selected != defaultContext {
		return fromContext(e, selected, sourceSelected)
	}
	if e.Getenv("DOCKER_HOST") != "" {
		ep, opts, err := fromEnvHost(e)
		if err == nil && selected == defaultContext {
			ep.Source = sourceSelected
		}
		return ep, opts, err
	}
	if selected == "" {
		if name := e.currentContextName(); name != "" && name != defaultContext {
			return fromContext(e, name, sourceContext)
		}
	}
	source := sourceDefault
	if selected == defaultContext {
		source = sourceSelected
	}
	host := defaultSocket
	if !e.exists(strings.TrimPrefix(defaultSocket, "unix://")) {
		for _, rel := range []string{".docker/run/docker.sock", ".colima/default/docker.sock", ".orbstack/run/docker.sock", ".rd/docker.sock"} {
			if p := filepath.Join(e.Home, rel); e.exists(p) {
				host, source = "unix://"+p, sourceProbe
				break
			}
		}
	}
	ep, opts, err := hostOpts(host, tlsFiles{}, false, false)
	if err != nil {
		return Endpoint{}, nil, err
	}
	ep.Context, ep.Source = defaultContext, source
	return ep, opts, nil
}

// listContexts returns every docker context, "default" first.
func listContexts(e resolveEnv, selected string) ([]ContextInfo, error) {
	current := selected
	if current == "" {
		current = e.currentContextName()
	}
	if current == "" {
		current = defaultContext
	}
	defHost := e.Getenv("DOCKER_HOST")
	if defHost == "" {
		defHost = defaultSocket
	}
	out := []ContextInfo{{Name: defaultContext, Host: defHost, Description: "Current DOCKER_HOST based configuration", Current: current == defaultContext}}

	metaDir := filepath.Join(e.configDir(), "contexts", "meta")
	entries, err := os.ReadDir(metaDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return out, nil
		}
		return nil, fmt.Errorf("list docker contexts: %w", err)
	}
	var found []ContextInfo
	for _, ent := range entries {
		raw, err := os.ReadFile(filepath.Join(metaDir, ent.Name(), "meta.json"))
		if err != nil {
			continue
		}
		var m contextMeta
		if json.Unmarshal(raw, &m) != nil || m.Name == "" {
			continue
		}
		found = append(found, ContextInfo{Name: m.Name, Host: m.Endpoints["docker"].Host, Description: m.Metadata.Description, Current: m.Name == current})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Name < found[j].Name })
	return append(out, found...), nil
}
