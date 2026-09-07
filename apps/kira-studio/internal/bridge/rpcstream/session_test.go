package rpcstream

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// internalPipeSession mirrors gitstream_test.go's own pipeSession (package bridge_test) —
// duplicated rather than shared because this file lives in package rpcstream, the one place
// session/Emit are reachable at all, and the two files otherwise test genuinely different things
// (the public wire contract vs. this one internal-only capability).
type internalPipeSession struct {
	in     chan []byte
	out    chan []byte
	closed chan struct{}
}

func newInternalPipeSession() *internalPipeSession {
	return &internalPipeSession{in: make(chan []byte, 4), out: make(chan []byte, 4), closed: make(chan struct{})}
}

func (p *internalPipeSession) Send(frame []byte) error {
	select {
	case p.out <- frame:
		return nil
	case <-p.closed:
		return errors.New("closed")
	}
}

func (p *internalPipeSession) Receive() ([]byte, error) {
	select {
	case b := <-p.in:
		return b, nil
	case <-p.closed:
		return nil, errors.New("closed")
	}
}

// TestSession_Emit_EventCrosses proves the event half of the frame protocol directly, against a
// bare Conn — gitsession's own subscriber_test.go/conn_test.go prove Emit is actually reached in
// production, but not the wire shape 'evt' crosses as, which is this package's own job to prove.
func TestSession_Emit_EventCrosses(t *testing.T) {
	conn := newInternalPipeSession()
	// Emit never touches h — a zero-value Request/Stream pair (never invoked in this test) plus
	// a contract version is enough to construct a session to Emit through.
	const contractVersion = 3
	session := NewSession(conn, Handlers{ContractVersion: contractVersion})
	defer session.close()

	type payload struct {
		RepoID string `json:"repoId"`
		Kind   string `json:"kind"`
	}
	session.Emit("repo.changed", payload{RepoID: "abc", Kind: "refsChanged"})

	select {
	case raw := <-conn.out:
		var env envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if env.Version != contractVersion {
			t.Errorf("Version = %d, want %d", env.Version, contractVersion)
		}
		if env.Body.T != "evt" || env.Body.Method != "repo.changed" {
			t.Fatalf("Body = %+v, want an evt frame for repo.changed", env.Body)
		}
		var got payload
		if err := json.Unmarshal(env.Body.Payload, &got); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if got.RepoID != "abc" || got.Kind != "refsChanged" {
			t.Errorf("payload = %+v, want {abc refsChanged}", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the emitted event")
	}
}

// recvFrame drains one frame off conn.out, failing the test on a timeout.
func recvFrame(t *testing.T, conn *internalPipeSession) []byte {
	t.Helper()
	select {
	case raw := <-conn.out:
		return raw
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a frame")
		return nil
	}
}

// TestSession_Stream_EmitsBlobAndJSONChunks is D5/§3.6's own proof: a stream handler emitting two
// chunks, one carrying an out-of-band blob and one not, and a fake Conn asserting the exact bytes
// of both — including that the JSON-only chunk is byte-identical to what encodeBody(env, nil)
// (and therefore every non-blob frame this package has always sent) produces.
func TestSession_Stream_EmitsBlobAndJSONChunks(t *testing.T) {
	conn := newInternalPipeSession()
	const contractVersion = 7
	streamDone := make(chan struct{})

	type chunkPayload struct {
		Value string `json:"value"`
	}

	h := Handlers{
		ContractVersion: contractVersion,
		Request: func(context.Context, string, json.RawMessage) (any, error) {
			return nil, nil
		},
		Stream: func(_ context.Context, _ string, _ json.RawMessage, emit func(payload any, blob []byte) error) error {
			defer close(streamDone)
			if err := emit(chunkPayload{Value: "with-blob"}, []byte("the-blob-bytes")); err != nil {
				return err
			}
			if err := emit(chunkPayload{Value: "no-blob"}, nil); err != nil {
				return err
			}
			return nil
		},
	}
	session := NewSession(conn, h)
	go session.Serve()
	defer session.close()

	openEnv := envelope{Version: contractVersion, Body: frame{T: "open", ID: 1, Method: "graph.stream", Params: json.RawMessage(`{}`)}}
	openBytes, err := json.Marshal(openEnv)
	if err != nil {
		t.Fatalf("marshal open: %v", err)
	}
	conn.in <- openBytes

	creditEnv := envelope{Version: contractVersion, Body: frame{T: "credit", ID: 1, N: 2}}
	creditBytes, err := json.Marshal(creditEnv)
	if err != nil {
		t.Fatalf("marshal credit: %v", err)
	}
	conn.in <- creditBytes

	// Chunk 1: a blob frame — 0x00 | uint32BE headerLen | headerJSON | blob.
	raw1 := recvFrame(t, conn)
	if len(raw1) == 0 || raw1[0] != blobFrameDiscriminant {
		t.Fatalf("chunk 1 first byte missing or wrong, want the blob discriminant 0x00, got %v", raw1)
	}
	headerLen1 := binary.BigEndian.Uint32(raw1[1:5])
	header1 := raw1[5 : 5+int(headerLen1)]
	blob1 := raw1[5+int(headerLen1):]
	if string(blob1) != "the-blob-bytes" {
		t.Fatalf("chunk 1 blob = %q, want %q", blob1, "the-blob-bytes")
	}
	var env1 envelope
	if err := json.Unmarshal(header1, &env1); err != nil {
		t.Fatalf("unmarshal chunk 1 header: %v", err)
	}
	if env1.Body.T != "chunk" || env1.Body.ID != 1 || env1.Body.Seq != 0 {
		t.Fatalf("chunk 1 body = %+v, want {chunk 1 0 ...}", env1.Body)
	}
	var payload1 chunkPayload
	if err := json.Unmarshal(env1.Body.Chunk, &payload1); err != nil {
		t.Fatalf("unmarshal chunk 1 payload: %v", err)
	}
	if payload1.Value != "with-blob" {
		t.Fatalf("chunk 1 payload = %+v", payload1)
	}

	// Chunk 2: plain JSON, byte-identical to json.Marshal of the equivalent envelope — the same
	// bytes a 'res' frame (or any pre-G3 frame) has always produced.
	raw2 := recvFrame(t, conn)
	if len(raw2) > 0 && raw2[0] == blobFrameDiscriminant {
		t.Fatalf("chunk 2 should be a plain JSON frame, got a blob-frame discriminant: %v", raw2)
	}
	payload2JSON, err := json.Marshal(chunkPayload{Value: "no-blob"})
	if err != nil {
		t.Fatalf("marshal payload2: %v", err)
	}
	wantEnv2 := envelope{Version: contractVersion, Body: frame{T: "chunk", ID: 1, Seq: 1, Chunk: payload2JSON}}
	wantBytes2, err := json.Marshal(wantEnv2)
	if err != nil {
		t.Fatalf("marshal wantEnv2: %v", err)
	}
	if string(raw2) != string(wantBytes2) {
		t.Fatalf("chunk 2 = %s, want byte-identical %s", raw2, wantBytes2)
	}

	<-streamDone
	rawEnd := recvFrame(t, conn)
	var endEnv envelope
	if err := json.Unmarshal(rawEnd, &endEnv); err != nil {
		t.Fatalf("unmarshal end: %v", err)
	}
	if endEnv.Body.T != "end" || endEnv.Body.ID != 1 || endEnv.Body.Error != nil {
		t.Fatalf("end body = %+v, want a clean end for id 1", endEnv.Body)
	}
}

// TestCreditGate_GrantUnblocksAcquire proves the credit gate's own contract in isolation — a
// waiter blocked on acquire is released by grant, exactly once per unit of credit.
func TestCreditGate_GrantUnblocksAcquire(t *testing.T) {
	g := newCreditGate()
	done := make(chan error, 1)
	go func() {
		done <- g.acquire(context.Background())
	}()

	select {
	case <-done:
		t.Fatal("acquire returned before any credit was granted")
	case <-time.After(20 * time.Millisecond):
	}

	g.grant(1)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("acquire: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("acquire did not unblock after grant")
	}
}

func TestCreditGate_AcquireRespectsCancellation(t *testing.T) {
	g := newCreditGate()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := g.acquire(ctx); err == nil {
		t.Fatal("acquire with an already-cancelled context: want an error")
	}
}
