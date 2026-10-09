package apiflow

import (
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/windowsvc"
)

func TestHistoryClear(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)
	gsrv := flowharness.GRPC(t)

	for _, tab := range []string{"tab-a", "tab-b"} {
		args := get(srv.URL + "/status?tab=" + tab)
		args.TabID = tab
		send(t, app, args)
		call := bridge.GrpcCallArgs{
			OpID: newOp(), TabID: tab, WindowKey: "w1", DescriptorMode: "reflection", Target: gsrv.Addr,
			Service: "kira.flow.v1.Flow", Method: "Unary", MessageJSON: `{"text":"` + tab + `"}`,
		}
		if _, err := app.W.Grpc.Call(ctx, call); err != nil {
			t.Fatal(err)
		}
		waitOp(t, app, args.OpID)
		waitOp(t, app, call.OpID)
	}

	httpLen := func(tab string) int {
		t.Helper()
		l, err := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{TabID: tab})
		if err != nil {
			t.Fatal(err)
		}
		return len(l)
	}
	grpcLen := func(tab string) int {
		t.Helper()
		l, err := app.W.GrpcHistory.List(bridge.GrpcHistoryScopeArgs{TabID: tab})
		if err != nil {
			t.Fatal(err)
		}
		return len(l)
	}
	for _, tab := range []string{"tab-a", "tab-b"} {
		if httpLen(tab) != 1 || grpcLen(tab) != 1 {
			t.Fatalf("%s history before Clear: http %d, grpc %d, want 1 each", tab, httpLen(tab), grpcLen(tab))
		}
	}

	if err := app.W.ResponseHistory.Clear(bridge.ResponseHistoryScopeArgs{TabID: "tab-a"}); err != nil {
		t.Fatal(err)
	}
	if httpLen("tab-a") != 0 || httpLen("tab-b") != 1 || grpcLen("tab-a") != 1 {
		t.Fatalf("ResponseHistory.Clear leaked: a http %d, b http %d, a grpc %d", httpLen("tab-a"), httpLen("tab-b"), grpcLen("tab-a"))
	}
	if err := app.W.GrpcHistory.Clear(bridge.GrpcHistoryScopeArgs{TabID: "tab-a"}); err != nil {
		t.Fatal(err)
	}
	if grpcLen("tab-a") != 0 || grpcLen("tab-b") != 1 || httpLen("tab-b") != 1 {
		t.Fatalf("GrpcHistory.Clear leaked: a grpc %d, b grpc %d, b http %d", grpcLen("tab-a"), grpcLen("tab-b"), httpLen("tab-b"))
	}

	// A relaunch sweeps history of tabs that no longer exist, so only tab-b (open) keeps its rows.
	tabB := model.TabRecord{ID: "tab-b", Path: "p/tab-b", Kind: "http-request", State: json.RawMessage(`{}`), Active: true}
	if _, err := app.W.WindowsSvc.Ensure(windowsvc.EnsureArgs{WindowKey: "w1"}); err != nil {
		t.Fatal(err)
	}
	if err := app.W.Tabs.Save(bridge.TabsSaveArgs{WindowKey: "w1", Tabs: []model.TabRecord{tabB}}); err != nil {
		t.Fatal(err)
	}
	app.Restart(t)
	if httpLen("tab-a") != 0 || grpcLen("tab-a") != 0 || httpLen("tab-b") != 1 || grpcLen("tab-b") != 1 {
		t.Fatal("cleared and kept history differ after a relaunch")
	}
}
