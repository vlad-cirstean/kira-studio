package docker

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

// A failed alias reconnect must put the original endpoint back and say so in the error details.
func TestAliasChangeReconnectFailureRestores(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	connects := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/disconnect"):
			calls = append(calls, "disconnect")
			w.WriteHeader(http.StatusOK)
		case strings.HasSuffix(r.URL.Path, "/connect"):
			connects++
			calls = append(calls, "connect")
			if connects == 1 {
				http.Error(w, `{"message":"address already in use"}`, http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	cli, err := client.New(client.WithHost("tcp://"+strings.TrimPrefix(srv.URL, "http://")), client.WithAPIVersion("1.47"))
	if err != nil {
		t.Fatal(err)
	}
	x := &inPlaceRun{
		m: &Manager{}, cli: cli, ctx: context.Background(),
		r:    container.InspectResponse{ID: "c1", NetworkSettings: &container.NetworkSettings{Networks: map[string]*network.EndpointSettings{"n": {Aliases: []string{"old"}}}}},
		cur:  EditSpec{InPlace: InPlaceSpec{Networks: []EditNetwork{{Name: "n", Aliases: []string{"old"}}}}},
		want: InPlaceSpec{Networks: []EditNetwork{{Name: "n", Aliases: []string{"new"}}}},
	}
	err = x.networks()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) || !strings.Contains(string(ie.Details), `"restored":true`) {
		t.Fatalf("err = %v, want details restored:true", err)
	}
	if got := strings.Join(calls, ","); got != "disconnect,connect,connect" {
		t.Fatalf("calls = %s, want disconnect, failed connect, restoring connect", got)
	}
}
