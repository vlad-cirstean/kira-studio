package connections

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/preconnect"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// resolved is resolve's and resolveFromInput's shared return shape: the engine-bound config plus
// the two preconnect fields stripped from it, which only doConnect needs.
type resolved struct {
	config            model.ResolvedConnectionConfig
	preconnect        *string
	preconnectSidecar bool
	// readyAddr is the loopback host:port the pre-connect script is expected to open ("" when the
	// target is not a loopback address with an explicit port).
	readyAddr string
	// P28 §5.5: not a ResolvedConnectionConfig field (that shape carries a password and exists for
	// adapters; a UI pacing knob doesn't belong in it) — carried alongside it purely so attemptConnect
	// can hand it to Backend.SetThrottle from the summary it already read.
	throttlePerSec float64
}

// resolve reads the row and its secret: fields mode reads the password column, URI mode decrypts
// the whole URI (P181) and derives Options from its query on top of the stored ones. Never returned
// over IPC (D9 — the engine channel is the only consumer).
func resolve(conns *repos.ConnectionsRepo, secrets *repos.SecretsRepo, id string) (resolved, error) {
	summary, err := conns.Get(id)
	if err != nil {
		return resolved{}, fmt.Errorf("connections: resolve %s: %w", id, err)
	}
	if summary == nil {
		return resolved{}, fmt.Errorf("connection %s not found", id)
	}

	var password, uri *string
	options := summary.Options
	if summary.Mode == "uri" {
		uri, err = secrets.GetURI(id)
		if err != nil {
			return resolved{}, fmt.Errorf("connections: resolve %s: %w", id, err)
		}
		if uri == nil {
			return resolved{}, fmt.Errorf("connection %s has no stored URI", id)
		}
		options = mergeOptions(options, uriQueryOptions(*uri))
	} else {
		password, err = secrets.Get(id)
		if err != nil {
			return resolved{}, fmt.Errorf("connections: resolve %s: %w", id, err)
		}
	}

	cfg := model.ResolvedConnectionConfig{
		ID: summary.ID, Name: summary.Name, Kind: summary.Kind, Color: summary.Color,
		Mode: summary.Mode, ReadOnly: summary.ReadOnly, Host: summary.Host, Port: summary.Port,
		Database: summary.Database, Username: summary.Username, URI: uri, Options: options,
		SortOrder: summary.SortOrder, CreatedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt,
		Password: password,
	}
	return resolved{
		config:            cfg,
		readyAddr:         readyAddr(cfg),
		preconnect:        summary.Preconnect,
		preconnectSidecar: summary.PreconnectSidecar,
		throttlePerSec:    summary.ThrottlePerSec,
	}, nil
}

// mergeOptions overlays over onto a copy of base.
func mergeOptions(base, over map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(over))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range over {
		out[k] = v
	}
	return out
}

// resolveFromInput builds the same shape as resolve, but from an unsaved draft (the dialog's
// "Test connection" button tests the input as typed, not what is on disk) — connections.ts:146's
// literals `sortOrder: 0`, empty timestamps.
//
// P21 round 2 architecture/security finding 9: the id used to be the literal "test", a faithful
// port of the TypeScript's own literal that predates multi-window (P8). Preconnect.Start keys its
// tracked sidecar process on this same id and kills anything already tracked under it
// (preconnect/supervisor.go's own Start) — with two workbench windows open, two concurrent Test
// connection presses on two different drafts both used the key "test", so the second Start
// SIGTERMed the first's still-settling sidecar and the first Test's own deferred Stop could kill
// the second's, producing a spurious "Pre-connect script failed" against a script that was fine.
// A fresh id per call (nothing downstream depends on the literal) makes two concurrent Test calls
// independent, the same way two real connections never collide on Preconnect's key.
func resolveFromInput(in Input) resolved {
	var uri, password *string
	options := in.Options
	if in.Mode == "uri" && in.URI != nil {
		folded := foldPassword(*in.URI, in.Password)
		uri = &folded
		options = mergeOptions(options, uriQueryOptions(folded))
	} else {
		password = in.Password
	}
	cfg := model.ResolvedConnectionConfig{
		ID: "test:" + uuid.NewString(), Name: in.Name, Kind: in.Kind, Color: in.Color, Mode: in.Mode,
		ReadOnly: in.ReadOnly, Host: in.Host, Port: in.Port, Database: in.Database,
		Username: in.Username, URI: uri, Options: options,
		SortOrder: 0, CreatedAt: "", UpdatedAt: "",
		Password: password,
	}
	return resolved{
		config:            cfg,
		readyAddr:         readyAddr(cfg),
		preconnect:        in.Preconnect,
		preconnectSidecar: in.PreconnectSidecar,
	}
}

// readyCheck is the TCP-dial readiness probe for addr, or nil (settle-window fallback) when addr is "".
func readyCheck(addr string) *preconnect.ReadyCheck {
	if addr == "" {
		return nil
	}
	return preconnect.DialReady(addr)
}

// readyAddr derives the loopback host:port a pre-connect tunnel script is expected to listen on.
// A non-loopback target says nothing about the script (it is reachable regardless), so it yields "".
func readyAddr(cfg model.ResolvedConnectionConfig) string {
	if fileKinds[cfg.Kind] {
		return ""
	}
	var host, port string
	if cfg.Mode == "uri" {
		if cfg.URI == nil {
			return ""
		}
		u, err := url.Parse(*cfg.URI)
		if err != nil || strings.Contains(u.Host, ",") {
			return ""
		}
		host, port = u.Hostname(), u.Port()
	} else {
		if cfg.Host == nil || cfg.Port == nil {
			return ""
		}
		host, port = *cfg.Host, strconv.Itoa(*cfg.Port)
	}
	if host == "" || port == "" || !isLoopback(host) {
		return ""
	}
	return net.JoinHostPort(host, port)
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
