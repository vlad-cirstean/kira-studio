package grpcclient

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// reflectKind is which of ServerReflectionRequest's two file-locating variants a fetch uses.
type reflectKind int

const (
	byFileContainingSymbol reflectKind = iota
	byFilename
)

// reflectionTransport is the one seam between the version-negotiation this file does (v1, falling
// back to v1alpha on codes.Unimplemented, D4/F2) and the recursive dependency-linking algorithm
// resolveViaTransport runs — v1 and v1alpha are structurally identical wire protocols with two
// distinct generated Go packages, so this interface is what lets that algorithm be written once.
type reflectionTransport interface {
	listServices() ([]string, error)
	fetch(kind reflectKind, value string) ([][]byte, error)
}

// ---- v1 ----

type v1Transport struct {
	stream grpc_reflection_v1.ServerReflection_ServerReflectionInfoClient
}

func newV1Transport(ctx context.Context, conn *grpc.ClientConn) (*v1Transport, error) {
	stream, err := grpc_reflection_v1.NewServerReflectionClient(conn).ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &v1Transport{stream: stream}, nil
}

func (t *v1Transport) listServices() ([]string, error) {
	if err := t.stream.Send(&grpc_reflection_v1.ServerReflectionRequest{
		MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: "*"},
	}); err != nil {
		return nil, err
	}
	resp, err := t.stream.Recv()
	if err != nil {
		return nil, err
	}
	if e := resp.GetErrorResponse(); e != nil {
		return nil, status.Error(codes.Code(e.GetErrorCode()), e.GetErrorMessage())
	}
	list := resp.GetListServicesResponse()
	if list == nil {
		return nil, fmt.Errorf("grpcclient: reflection: unexpected response to ListServices")
	}
	return filterServiceNames(list.GetService()), nil
}

func (t *v1Transport) fetch(kind reflectKind, value string) ([][]byte, error) {
	req := &grpc_reflection_v1.ServerReflectionRequest{}
	switch kind {
	case byFileContainingSymbol:
		req.MessageRequest = &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: value}
	case byFilename:
		req.MessageRequest = &grpc_reflection_v1.ServerReflectionRequest_FileByFilename{FileByFilename: value}
	}
	if err := t.stream.Send(req); err != nil {
		return nil, err
	}
	resp, err := t.stream.Recv()
	if err != nil {
		return nil, err
	}
	if e := resp.GetErrorResponse(); e != nil {
		return nil, status.Error(codes.Code(e.GetErrorCode()), e.GetErrorMessage())
	}
	fd := resp.GetFileDescriptorResponse()
	if fd == nil {
		return nil, fmt.Errorf("grpcclient: reflection: unexpected response")
	}
	return fd.GetFileDescriptorProto(), nil
}

// ---- v1alpha (D4's fallback, on codes.Unimplemented from v1 — the same negotiation
// grpcreflect.NewClientAuto performs, F2) ----

type v1AlphaTransport struct {
	stream grpc_reflection_v1alpha.ServerReflection_ServerReflectionInfoClient
}

func newV1AlphaTransport(ctx context.Context, conn *grpc.ClientConn) (*v1AlphaTransport, error) {
	stream, err := grpc_reflection_v1alpha.NewServerReflectionClient(conn).ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &v1AlphaTransport{stream: stream}, nil
}

func (t *v1AlphaTransport) listServices() ([]string, error) {
	if err := t.stream.Send(&grpc_reflection_v1alpha.ServerReflectionRequest{
		MessageRequest: &grpc_reflection_v1alpha.ServerReflectionRequest_ListServices{ListServices: "*"},
	}); err != nil {
		return nil, err
	}
	resp, err := t.stream.Recv()
	if err != nil {
		return nil, err
	}
	if e := resp.GetErrorResponse(); e != nil {
		return nil, status.Error(codes.Code(e.GetErrorCode()), e.GetErrorMessage())
	}
	list := resp.GetListServicesResponse()
	if list == nil {
		return nil, fmt.Errorf("grpcclient: reflection: unexpected response to ListServices")
	}
	names := make([]*grpc_reflection_v1.ServiceResponse, 0, len(list.GetService()))
	for _, s := range list.GetService() {
		names = append(names, &grpc_reflection_v1.ServiceResponse{Name: s.GetName()})
	}
	return filterServiceNames(names), nil
}

func (t *v1AlphaTransport) fetch(kind reflectKind, value string) ([][]byte, error) {
	req := &grpc_reflection_v1alpha.ServerReflectionRequest{}
	switch kind {
	case byFileContainingSymbol:
		req.MessageRequest = &grpc_reflection_v1alpha.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: value}
	case byFilename:
		req.MessageRequest = &grpc_reflection_v1alpha.ServerReflectionRequest_FileByFilename{FileByFilename: value}
	}
	if err := t.stream.Send(req); err != nil {
		return nil, err
	}
	resp, err := t.stream.Recv()
	if err != nil {
		return nil, err
	}
	if e := resp.GetErrorResponse(); e != nil {
		return nil, status.Error(codes.Code(e.GetErrorCode()), e.GetErrorMessage())
	}
	fd := resp.GetFileDescriptorResponse()
	if fd == nil {
		return nil, fmt.Errorf("grpcclient: reflection: unexpected response")
	}
	return fd.GetFileDescriptorProto(), nil
}

// filterServiceNames drops the reflection service's own entries (grpc.reflection.v1.*,
// grpc.reflection.v1alpha.*) — showing gRPC's own bookkeeping service in a schema browser serves
// no purpose.
func filterServiceNames(services []*grpc_reflection_v1.ServiceResponse) []string {
	out := make([]string, 0, len(services))
	for _, s := range services {
		if strings.HasPrefix(s.GetName(), "grpc.reflection.") {
			continue
		}
		out = append(out, s.GetName())
	}
	return out
}

// resolveReflection is D4's reflection source: one ServerReflectionInfo bidi stream, ListServices,
// then FileContainingSymbol per service, linking every returned FileDescriptorProto into this
// Source's own private registry (F14) — recursing through FileByFilename for any dependency the
// server did not volunteer (F2: grpc-go volunteers them, the protocol does not require it).
func resolveReflection(ctx context.Context, src Source) (*resolved, error) {
	if src.Target == "" {
		return nil, BadRequest("a target is required")
	}

	conn, err := dialConn(src.Target, src.TLS)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	callCtx, err := withMetadata(ctx, src.Metadata)
	if err != nil {
		return nil, err
	}

	transport, mode, services, err := negotiateAndListServices(callCtx, conn)
	if err != nil {
		if status.Code(err) == codes.Unimplemented {
			// F11: distinguishable from every other failure by code alone — "This server does not
			// expose gRPC reflection" (D17) rather than an opaque "call failed".
			return nil, SchemaError("This server does not expose gRPC reflection. Supply a .proto file instead.")
		}
		return nil, Transport(err.Error())
	}

	reg := new(protoregistry.Files)
	known := map[string]*descriptorpb.FileDescriptorProto{}
	linked := map[string]bool{}

	var link func(path string) error
	link = func(path string) error {
		if linked[path] {
			return nil
		}
		raw, ok := known[path]
		if !ok {
			protos, err := transport.fetch(byFilename, path)
			if err != nil {
				return err
			}
			if err := absorb(known, protos); err != nil {
				return err
			}
			raw, ok = known[path]
			if !ok {
				return fmt.Errorf("grpcclient: reflection: server did not return %s", path)
			}
		}
		for _, dep := range raw.GetDependency() {
			if err := link(dep); err != nil {
				return err
			}
		}
		fd, err := protodesc.NewFile(raw, reg)
		if err != nil {
			return fmt.Errorf("linking %s: %w", path, err)
		}
		if err := reg.RegisterFile(fd); err != nil {
			// F14: this is a private registry (never GlobalFiles), so a duplicate returns an
			// error rather than panicking.
			return fmt.Errorf("registering %s: %w", path, err)
		}
		linked[path] = true
		return nil
	}

	for _, svc := range services {
		protos, err := transport.fetch(byFileContainingSymbol, svc)
		if err != nil {
			return nil, Transport(err.Error())
		}
		if err := absorb(known, protos); err != nil {
			return nil, SchemaError(err.Error())
		}
	}
	for path := range known {
		if err := link(path); err != nil {
			return nil, SchemaError(err.Error())
		}
	}

	return &resolved{files: reg, mode: mode}, nil
}

// negotiateAndListServices tries v1 first — opening the stream and sending ListServices — and
// falls back to v1alpha on codes.Unimplemented from either step, the same negotiation
// grpcreflect.NewClientAuto performs (F2), here in ~20 lines rather than a third-party dependency
// (D1). The service list comes back alongside the chosen transport so the one ListServices round
// trip this negotiation needs is never repeated.
func negotiateAndListServices(ctx context.Context, conn *grpc.ClientConn) (reflectionTransport, string, []string, error) {
	v1, err := newV1Transport(ctx, conn)
	if err == nil {
		services, listErr := v1.listServices()
		if listErr == nil {
			return v1, "reflection-v1", services, nil
		}
		if status.Code(listErr) != codes.Unimplemented {
			return nil, "", nil, listErr
		}
	} else if status.Code(err) != codes.Unimplemented {
		return nil, "", nil, err
	}

	v1alpha, err := newV1AlphaTransport(ctx, conn)
	if err != nil {
		return nil, "", nil, err
	}
	services, err := v1alpha.listServices()
	if err != nil {
		return nil, "", nil, err
	}
	return v1alpha, "reflection-v1alpha", services, nil
}

// absorb decodes every raw FileDescriptorProto byte blob a response carried and stores it by
// path — a single FileContainingSymbol response commonly bundles the transitive dependencies too
// (F2: "deps fetched=2" from one response), so this is what makes them available to link() without
// a second round trip.
func absorb(known map[string]*descriptorpb.FileDescriptorProto, protos [][]byte) error {
	for _, b := range protos {
		var fd descriptorpb.FileDescriptorProto
		if err := proto.Unmarshal(b, &fd); err != nil {
			return fmt.Errorf("grpcclient: reflection: decoding FileDescriptorProto: %w", err)
		}
		known[fd.GetName()] = &fd
	}
	return nil
}
