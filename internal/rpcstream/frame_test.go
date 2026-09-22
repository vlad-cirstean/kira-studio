package rpcstream

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestEncodeBody_NilBlobIsByteIdenticalToPlainJSON(t *testing.T) {
	env := envelope{Version: 5, Body: frame{T: "res", ID: 3, OK: boolPtr(true)}}
	got, err := encodeBody(env, nil)
	if err != nil {
		t.Fatalf("encodeBody: %v", err)
	}
	want, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("encodeBody(env, nil) = %s, want byte-identical to json.Marshal(env) = %s", got, want)
	}
}

func TestEncodeBody_BlobLayout(t *testing.T) {
	env := envelope{Version: 5, Body: frame{T: "chunk", ID: 1, Chunk: json.RawMessage(`{"$blob":true}`)}}
	blob := []byte("hello-blob-bytes")

	got, err := encodeBody(env, blob)
	if err != nil {
		t.Fatalf("encodeBody: %v", err)
	}
	if len(got) == 0 || got[0] != blobFrameDiscriminant {
		t.Fatalf("first byte missing or wrong, want the blob discriminant 0x00, got %v", got)
	}
	headerLen := binary.BigEndian.Uint32(got[1:5])
	header := got[5 : 5+int(headerLen)]
	gotBlob := got[5+int(headerLen):]

	wantHeader, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if !bytes.Equal(header, wantHeader) {
		t.Fatalf("header = %s, want %s", header, wantHeader)
	}
	if !bytes.Equal(gotBlob, blob) {
		t.Fatalf("blob = %q, want %q", gotBlob, blob)
	}
}
