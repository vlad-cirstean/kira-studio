package grpcclient

import (
	"context"
	"io"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// maxRecvMsgSize is D15's own bound — 16 MiB, this app's limit and not the server's, reported
// (never hidden) as codes.ResourceExhausted when exceeded (F9).
const maxRecvMsgSize = 16 * 1024 * 1024

// maxStoredMessages bounds ServerStream's own in-memory CallResult.Messages accumulator — kept
// numerically equal to repos/grpc_history.go's own maxGrpcStoredMessages (that package cannot be
// imported here, storage sitting above this client in the dependency order, and one bound int is
// not worth a shared-constants package). Without this, a long-running stream would grow
// CallResult.Messages without limit for the full life of the call, long before Record ever gets a
// chance to cap what it persists — MessageCount/MessageBytes (below) keep counting the true totals
// regardless, which is what recordGrpcHistory's own elision check (repos/grpc_history.go) compares
// against, not the length of this already-capped slice.
const maxStoredMessages = 100

// CallRequest carries everything Unary/ServerStream need: the target and its TLS decision (D6),
// the Source the method's descriptor resolves from (reusing Describe's own cache, D4), the fully
// qualified "/pkg.Service/Method" path, the request message JSON and the metadata — every field
// here is already resolved (§0.3: this package is called only from inside the bridge's own
// resolved-at-point-of-use closure, D9/D10).
type CallRequest struct {
	Target     string
	TLS        TLSConfig
	Source     Source
	FullMethod string // "/pkg.Service/Method"

	MessageJSON string
	Metadata    []MetaPair
}

func grpcPath(m protoreflect.MethodDescriptor) string {
	svc := m.Parent().(protoreflect.ServiceDescriptor)
	return "/" + string(svc.FullName()) + "/" + string(m.Name())
}

func unmarshalRequestJSON(js string, msg *dynamicpb.Message) error {
	if strings.TrimSpace(js) == "" {
		js = "{}"
	}
	// F4: unknown-field rejection stays ON for the request — a typo'd field name in a request the
	// user is authoring must be an error, not a silently dropped field, and the error carries its
	// own line:col.
	if err := (protojson.UnmarshalOptions{}).Unmarshal([]byte(js), msg); err != nil {
		return BadRequest(err.Error())
	}
	return nil
}

func marshalResponseJSON(msg *dynamicpb.Message) (string, error) {
	// F4: DiscardUnknown is ON for the response (a server running a newer schema than the .proto
	// the user supplied must not make its own answer unreadable) and EmitUnpopulated is ON
	// (a proto3 scalar at its zero value is otherwise absent, and "the field is missing" vs. "the
	// field is 0" is precisely the question this pane exists to answer).
	b, err := (protojson.MarshalOptions{EmitUnpopulated: true}).Marshal(msg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// terminalOutcome is D16's own dispatch: nil for OK, a *Error for the two cases that mean "the
// call could not be made" (a context-caused Canceled/DeadlineExceeded — F8 — or codes.Unavailable
// — F10, which covers a refused connection, a TLS failure and a plaintext/TLS mismatch alike, so
// it is never split further here; bridge/grpc.go's own mapGrpcError is what gives it D17's three
// separate sentences, keyed on the error text). Every other code — including a real
// codes.ResourceExhausted from the message-size cap (F9) — is a result, not an error.
func terminalOutcome(ctx context.Context, err error) (code codes.Code, message string, asError *Error) {
	if err == nil {
		return codes.OK, "", nil
	}
	st := status.Convert(err)
	code, message = st.Code(), st.Message()
	if ctx.Err() != nil && (code == codes.Canceled || code == codes.DeadlineExceeded) {
		return code, message, Cancelled(message)
	}
	if code == codes.Unavailable {
		return code, message, Transport(message)
	}
	return code, message, nil
}

// Unary runs one request/response call (D7) — conn.Invoke over dynamicpb messages, no generated
// stubs anywhere.
func Unary(ctx context.Context, req CallRequest) (CallResult, error) {
	method, err := resolveMethod(ctx, req.Source, req.FullMethod)
	if err != nil {
		return CallResult{}, err
	}
	if method.IsStreamingClient() || method.IsStreamingServer() {
		return CallResult{}, BadRequest(req.FullMethod + " is a streaming method, not unary")
	}

	conn, err := dialConn(req.Target, req.TLS)
	if err != nil {
		return CallResult{}, err
	}
	defer conn.Close()

	callCtx, err := withMetadata(ctx, req.Metadata)
	if err != nil {
		return CallResult{}, err
	}

	in := dynamicpb.NewMessage(method.Input())
	if err := unmarshalRequestJSON(req.MessageJSON, in); err != nil {
		return CallResult{}, err
	}
	out := dynamicpb.NewMessage(method.Output())

	var header, trailer metadata.MD
	start := time.Now()
	callErr := conn.Invoke(callCtx, grpcPath(method), in, out,
		grpc.Header(&header), grpc.Trailer(&trailer), grpc.MaxCallRecvMsgSize(maxRecvMsgSize))
	elapsed := time.Since(start)

	code, message, asError := terminalOutcome(callCtx, callErr)
	if asError != nil {
		return CallResult{}, asError
	}

	result := CallResult{
		Code: int32(code), CodeName: code.String(), StatusMessage: message,
		ElapsedMs: elapsed.Milliseconds(),
		Header:    mdToPairs(header), Trailer: mdToPairs(trailer),
	}
	if code == codes.OK {
		js, err := marshalResponseJSON(out)
		if err != nil {
			return CallResult{}, SchemaError("could not render the response: " + err.Error())
		}
		wire := proto.Size(out)
		result.Messages = []Message{{Seq: 0, JSON: js, WireBytes: wire, OffsetMs: elapsed.Milliseconds()}}
		result.MessageCount = 1
		result.MessageBytes = wire
	}
	return result, nil
}

// ServerStream runs one server-streaming call (D8), delivering each message through onMessage as
// it arrives (the arrival offset F5 measured is real, and is the single most informative thing
// about a stream) and returning the terminal result once the stream ends. Cancelling ctx mid-
// stream (the Stop button, via Host.RunOp's derived context) ends the stream at the next RecvMsg
// with codes.Canceled — the messages already delivered stay delivered (F8): they were already
// handed to onMessage, and the returned *Error's Partial field carries the true counts so a caller
// can still record a completed history entry.
func ServerStream(ctx context.Context, req CallRequest, onMessage func(Message)) (CallResult, error) {
	method, err := resolveMethod(ctx, req.Source, req.FullMethod)
	if err != nil {
		return CallResult{}, err
	}
	if !method.IsStreamingServer() || method.IsStreamingClient() {
		return CallResult{}, BadRequest(req.FullMethod + " is not a server-streaming method")
	}

	conn, err := dialConn(req.Target, req.TLS)
	if err != nil {
		return CallResult{}, err
	}
	defer conn.Close()

	callCtx, err := withMetadata(ctx, req.Metadata)
	if err != nil {
		return CallResult{}, err
	}

	in := dynamicpb.NewMessage(method.Input())
	if err := unmarshalRequestJSON(req.MessageJSON, in); err != nil {
		return CallResult{}, err
	}

	desc := &grpc.StreamDesc{StreamName: string(method.Name()), ServerStreams: true}
	stream, err := conn.NewStream(callCtx, desc, grpcPath(method), grpc.MaxCallRecvMsgSize(maxRecvMsgSize))
	if err != nil {
		_, _, asError := terminalOutcome(callCtx, err)
		if asError != nil {
			return CallResult{}, asError
		}
		return CallResult{}, Transport(err.Error())
	}
	if err := stream.SendMsg(in); err != nil {
		_, _, asError := terminalOutcome(callCtx, err)
		if asError != nil {
			return CallResult{}, asError
		}
		return CallResult{}, Transport(err.Error())
	}
	if err := stream.CloseSend(); err != nil {
		_, _, asError := terminalOutcome(callCtx, err)
		if asError != nil {
			return CallResult{}, asError
		}
		return CallResult{}, Transport(err.Error())
	}

	start := time.Now()
	var count, totalBytes int
	var header metadata.MD
	messages := make([]Message, 0, maxStoredMessages)
	for {
		out := dynamicpb.NewMessage(method.Output())
		recvErr := stream.RecvMsg(out)
		if recvErr == io.EOF {
			break
		}
		if recvErr != nil {
			elapsed := time.Since(start)
			if header == nil {
				header, _ = stream.Header()
			}
			partial := CallResult{
				ElapsedMs: elapsed.Milliseconds(), Header: mdToPairs(header),
				Trailer: mdToPairs(stream.Trailer()), MessageCount: count, MessageBytes: totalBytes,
				Messages: messages,
			}
			code, message, asError := terminalOutcome(callCtx, recvErr)
			partial.Code, partial.CodeName, partial.StatusMessage = int32(code), code.String(), message
			if asError != nil {
				asError.Partial = &partial
				return CallResult{}, asError
			}
			return partial, nil
		}

		if header == nil {
			header, _ = stream.Header()
		}
		js, err := marshalResponseJSON(out)
		if err != nil {
			return CallResult{}, SchemaError("could not render a stream message: " + err.Error())
		}
		wire := proto.Size(out)
		msg := Message{Seq: count, JSON: js, WireBytes: wire, OffsetMs: time.Since(start).Milliseconds()}
		count++
		totalBytes += wire
		if len(messages) < maxStoredMessages {
			messages = append(messages, msg)
		}
		if onMessage != nil {
			onMessage(msg)
		}
	}

	elapsed := time.Since(start)
	if header == nil {
		header, _ = stream.Header()
	}
	return CallResult{
		Code: int32(codes.OK), CodeName: codes.OK.String(),
		ElapsedMs: elapsed.Milliseconds(), Header: mdToPairs(header), Trailer: mdToPairs(stream.Trailer()),
		MessageCount: count, MessageBytes: totalBytes, Messages: messages,
	}, nil
}
