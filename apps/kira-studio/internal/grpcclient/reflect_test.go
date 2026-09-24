package grpcclient

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// F1: a reflection server that returns a.proto importing b.proto and b.proto importing a.proto
// must not send linker.link into unbounded recursion (a fatal, unrecoverable Go stack overflow).
// Bounded with a timeout so a regression here fails the test instead of hanging the suite.
func TestLinkerLink_CyclicDependency_ReturnsError(t *testing.T) {
	a := &descriptorpb.FileDescriptorProto{
		Name:       proto.String("a.proto"),
		Syntax:     proto.String("proto3"),
		Dependency: []string{"b.proto"},
	}
	b := &descriptorpb.FileDescriptorProto{
		Name:       proto.String("b.proto"),
		Syntax:     proto.String("proto3"),
		Dependency: []string{"a.proto"},
	}

	l := &linker{
		reg: new(protoregistry.Files),
		known: map[string]*descriptorpb.FileDescriptorProto{
			"a.proto": a,
			"b.proto": b,
		},
		linked:     map[string]bool{},
		inProgress: map[string]bool{},
	}

	done := make(chan error, 1)
	go func() {
		done <- l.link("a.proto")
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error for a cyclic proto dependency, got nil")
		}
		if !strings.Contains(err.Error(), "cyclic") {
			t.Fatalf("expected a cycle-naming error, got: %v", err)
		}
		if !strings.Contains(err.Error(), "a.proto") || !strings.Contains(err.Error(), "b.proto") {
			t.Fatalf("expected the error to name the cycle, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("linker.link did not return — cyclic dependency was not detected")
	}
}
