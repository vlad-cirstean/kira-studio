package grpcflow

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/grpcclient"
)

func TestDescribeReflection(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.GRPC(t)

	s := describe(t, app, describeArgs(srv.Addr))
	if s.Mode != "reflection-v1" {
		t.Errorf("mode = %q, want reflection-v1", s.Mode)
	}
	for _, svc := range s.Services {
		if strings.HasPrefix(svc.Name, "grpc.reflection") {
			t.Errorf("reflection service %s is listed", svc.Name)
		}
	}
	want := map[string][2]bool{ // name -> client, server streaming
		"Unary": {false, false}, "ServerStream": {false, true}, "ClientStream": {true, false},
		"Bidi": {true, true}, "Fail": {false, false}, "Slow": {false, false},
	}
	for name, flags := range want {
		m, ok := findMethod(t, s, name)
		if !ok {
			t.Errorf("method %s missing", name)
			continue
		}
		if m.ClientStreaming != flags[0] || m.ServerStreaming != flags[1] {
			t.Errorf("%s streaming = client %v server %v, want %v", name, m.ClientStreaming, m.ServerStreaming, flags)
		}
		if m.FullName != flowSvc+"."+name {
			t.Errorf("%s full name = %q", name, m.FullName)
		}
		field := "text"
		if name == "Fail" {
			field = "code"
		}
		if !strings.Contains(m.RequestTemplate, field) {
			t.Errorf("%s request template = %q, want the %q field", name, m.RequestTemplate, field)
		}
	}
	if len(srv.Calls()) != 0 {
		t.Errorf("describe reached the service: %+v", srv.Calls())
	}
	t.Run("server needs metadata", func(t *testing.T) { describeNeedsMetadata(t, app) })
}

func describeNeedsMetadata(t *testing.T, app *flowharness.App) {
	srv := flowharness.GRPC(t, flowharness.WithRequiredMetadata("authorization", "Bearer sek-reflect"))

	_, err := app.W.Grpc.Describe(ctx, describeArgs(srv.Addr))
	e := ipcErr(t, err)
	if !strings.Contains(strings.ToLower(e.Message), "unauthenticated") {
		t.Errorf("error = %s %q, want the status named", e.Code, e.Message)
	}

	colID, envID := secretVars(t, app, map[string]string{"authz": "Bearer sek-reflect"})
	args := describeArgs(srv.Addr)
	args.CollectionID, args.EnvironmentID = colID, envID
	args.Metadata = []grpcclient.MetaPair{{Name: "authorization", Value: "{{authz}}"}}
	s := describe(t, app, args)
	if _, ok := findMethod(t, s, "Unary"); !ok {
		t.Error("describe with the secret metadata lacks Unary")
	}
}

func TestDescribeProtoAndCall(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.GRPC(t)

	// flow.proto in one dir, its import under a second dir reachable only through importPaths.
	mainDir, libDir := t.TempDir(), t.TempDir()
	flowSrc, err := os.ReadFile(filepath.Join(srv.ProtoDir, "flow.proto"))
	if err != nil {
		t.Fatal(err)
	}
	typesSrc, err := os.ReadFile(filepath.Join(srv.ProtoDir, "common", "types.proto"))
	if err != nil {
		t.Fatal(err)
	}
	protoPath := filepath.Join(mainDir, "flow.proto")
	if err := os.WriteFile(protoPath, flowSrc, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(libDir, "common"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(libDir, "common", "types.proto"), typesSrc, 0o600); err != nil {
		t.Fatal(err)
	}

	missing := describeArgsProto(protoPath, nil)
	_, err = app.W.Grpc.Describe(ctx, missing)
	e := ipcErr(t, err)
	if e.Code != grpcclient.CodeSchema || !strings.Contains(e.Message, "common/types.proto") {
		t.Errorf("missing import error = %s %q, want E_GRPC_SCHEMA naming common/types.proto", e.Code, e.Message)
	}

	byProto := describe(t, app, describeArgsProto(protoPath, []string{libDir}))
	byReflection := describe(t, app, describeArgs(srv.Addr))
	if byProto.Mode != "proto" {
		t.Errorf("mode = %q, want proto", byProto.Mode)
	}
	for _, name := range []string{"Unary", "ServerStream", "ClientStream", "Bidi", "Fail", "Slow"} {
		a, aok := findMethod(t, byProto, name)
		b, bok := findMethod(t, byReflection, name)
		if !aok || !bok || a != b {
			t.Errorf("%s differs between proto %+v and reflection %+v", name, a, b)
		}
	}

	args := callArgs(srv.Addr, "Unary", `{"text":"via proto","meta":{"origin":"x"}}`)
	args.DescriptorMode, args.ProtoPath, args.ImportPaths = "proto", protoPath, []string{libDir}
	res := call(t, app, args)
	if res.CodeName != "OK" || !strings.Contains(res.Messages[0].JSON, "via proto") {
		t.Errorf("proto-mode call = %s %+v", res.CodeName, res.Messages)
	}
	// The harness server records streaming calls only (finding A-2), so reach it with a stream too.
	stream := callArgs(srv.Addr, "ServerStream", `{"count":2}`)
	stream.Streaming = true
	stream.DescriptorMode, stream.ProtoPath, stream.ImportPaths = "proto", protoPath, []string{libDir}
	if got := call(t, app, stream); got.MessageCount != 2 {
		t.Errorf("proto-mode stream delivered %d messages, want 2", got.MessageCount)
	}
	if got := srv.Calls(); len(got) != 1 || got[0].Method != "/"+flowSvc+"/ServerStream" {
		t.Errorf("server calls = %+v, want one ServerStream", got)
	}
}

func describeArgsProto(path string, importPaths []string) bridge.GrpcDescribeArgs {
	return bridge.GrpcDescribeArgs{DescriptorMode: "proto", ProtoPath: path, ImportPaths: importPaths}
}

func TestReloadAfterSchemaChange(t *testing.T) {
	app := flowharness.New(t)
	first := flowharness.GRPC(t)
	addr := first.Addr

	if _, ok := findMethod(t, describe(t, app, describeArgs(addr)), "Extra"); ok {
		t.Fatal("Extra present before the schema change")
	}
	first.Close()
	flowharness.GRPC(t, flowharness.WithExtraMethod(), flowharness.WithGRPCAddr(addr))

	if _, ok := findMethod(t, describe(t, app, describeArgs(addr)), "Extra"); ok {
		t.Error("plain describe saw the new method; want the cached schema")
	}
	reload := describeArgs(addr)
	reload.Reload = true
	if _, ok := findMethod(t, describe(t, app, reload), "Extra"); !ok {
		t.Error("reload did not return the new method")
	}
	if _, ok := findMethod(t, describe(t, app, describeArgs(addr)), "Extra"); !ok {
		t.Error("after reload, the cache still holds the old schema")
	}
}

func TestDescribeSilentServer(t *testing.T) {
	t.Skip("P232 finding A-1: Describe against a silent server blocks 20 s then E_GRPC_TRANSPORT; 10 s budget fails")
	app := flowharness.New(t)
	addr := flowharness.Silent(t)

	start := time.Now()
	_, err := app.W.Grpc.Describe(ctx, describeArgs(addr))
	took := time.Since(start)
	if err == nil {
		t.Fatal("Describe against a silent server succeeded")
	}
	if took > 10*time.Second {
		t.Errorf("Describe took %s, want an error within 10s (Describe has no opId, so no cancel path exists)", took.Round(time.Second))
	}
}
