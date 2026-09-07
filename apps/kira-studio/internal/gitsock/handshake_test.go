package gitsock

import (
	"bufio"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// fakeTrustStore is an in-memory TrustStore for handshake_test.go — no SQLite needed to exercise
// §3.1.1's decision table.
type fakeTrustStore struct {
	mu   sync.Mutex
	rows map[string]repos.GitClientRow
}

func newFakeTrustStore() *fakeTrustStore {
	return &fakeTrustStore{rows: map[string]repos.GitClientRow{}}
}

func (f *fakeTrustStore) ByID(id string) (repos.GitClientRow, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[id]
	return row, ok, nil
}

func (f *fakeTrustStore) Insert(row repos.GitClientRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[row.ID] = row
	return nil
}

func (f *fakeTrustStore) TouchLastSeen(id string, now int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	row := f.rows[id]
	row.LastSeenAt = now
	f.rows[id] = row
	return nil
}

func (f *fakeTrustStore) Revoke(id string, now int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	row := f.rows[id]
	row.RevokedAt = &now
	f.rows[id] = row
	return nil
}

func (f *fakeTrustStore) List() ([]model.GitClient, error) { return nil, nil }

func testHandshakeDeps(clients TrustStore, broker *Broker, now func() time.Time) handshakeDeps {
	return handshakeDeps{Clients: clients, Broker: broker, ServerVersion: "1.2.3-test", Now: now}
}

// clientSend/clientReceive drive the raw wire from the test's side of a net.Pipe(), independent of
// gitsock's own conn type.
func clientSend(t *testing.T, w net.Conn, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := writeFrame(w, b); err != nil {
		t.Fatalf("write frame: %v", err)
	}
}

func clientReceive(t *testing.T, r *bufio.Reader) handshakeResponse {
	t.Helper()
	raw, err := readFrame(r)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var resp handshakeResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return resp
}

func TestHandshake_Row1_MalformedFrame_ClosesSilently(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	deps := testHandshakeDeps(newFakeTrustStore(), NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	if err := writeFrame(client, []byte("not json")); err != nil {
		t.Fatal(err)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false for a malformed frame")
	}
}

func TestHandshake_Row1_EmptyClientID_ClosesSilently(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	deps := testHandshakeDeps(newFakeTrustStore(), NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion})
	if ok := <-done; ok {
		t.Fatal("want ok=false for an empty client id")
	}
}

func TestHandshake_Row2_ProtocolMismatch(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	deps := testHandshakeDeps(newFakeTrustStore(), NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: 99, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"},
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "versionMismatch" || resp.Expected != gitrpc.Protocol || resp.Received != 99 {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false on protocol mismatch")
	}
}

func TestHandshake_Row3_ContractVersionMismatch(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	deps := testHandshakeDeps(newFakeTrustStore(), NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion + 1,
		Client: helloClient{ID: "c1"},
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "versionMismatch" || resp.Expected != gitrpc.ContractVersion || resp.Received != gitrpc.ContractVersion+1 {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false on contract version mismatch")
	}
}

func TestHandshake_Row4_ValidToken_Ready(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	store := newFakeTrustStore()
	plain, hash, salt, err := mintToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Insert(repos.GitClientRow{ID: "c1", Label: "vscode", TokenHash: hash, TokenSalt: salt}); err != nil {
		t.Fatal(err)
	}
	deps := testHandshakeDeps(store, NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"}, Token: &plain,
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "ready" || resp.ContractVersion != gitrpc.ContractVersion || resp.SessionID == "" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; !ok {
		t.Fatal("want ok=true for a valid token")
	}
	row, found, _ := store.ByID("c1")
	if !found || row.LastSeenAt == 0 {
		t.Fatalf("last seen not touched: %+v found=%v", row, found)
	}
}

func TestHandshake_Row5_TokenRejected_NoRow(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	deps := testHandshakeDeps(newFakeTrustStore(), NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	bogus := "not-a-real-token"
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "ghost"}, Token: &bogus,
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "tokenRejected" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false for an unknown client id")
	}
}

func TestHandshake_Row5_TokenRejected_RevokedRow(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	store := newFakeTrustStore()
	plain, hash, salt, err := mintToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Insert(repos.GitClientRow{ID: "c1", TokenHash: hash, TokenSalt: salt}); err != nil {
		t.Fatal(err)
	}
	if err := store.Revoke("c1", 1000); err != nil {
		t.Fatal(err)
	}
	deps := testHandshakeDeps(store, NewBroker(time.Now), time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"}, Token: &plain,
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "tokenRejected" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false for a revoked client")
	}
}

func TestHandshake_Row6_NoTokenInCooldown_DeniedImmediately(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	clock := newFakeClock()
	broker := NewBroker(clock.Now)

	// Manufacture a cooldown the direct way: deny a first request for this client id.
	enqueued := make(chan PairingRequest, 1)
	firstDone := make(chan PairingOutcome, 1)
	go func() {
		firstDone <- broker.Request("c1", "l", func(req PairingRequest) { enqueued <- req })
	}()
	req := <-enqueued
	broker.Deny(req.RequestID)
	<-firstDone

	deps := testHandshakeDeps(newFakeTrustStore(), broker, clock.Now)
	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"},
	})
	resp := clientReceive(t, bufio.NewReader(client))
	if resp.Kind != "pairingDenied" || resp.Reason != "denied" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false while in cooldown")
	}
}

func TestHandshake_Row7_PairingApproved_Ready(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	store := newFakeTrustStore()
	broker := NewBroker(time.Now)
	deps := testHandshakeDeps(store, broker, time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1", Label: "vscode"},
	})
	r := bufio.NewReader(client)
	pending := clientReceive(t, r)
	if pending.Kind != "pairingRequired" || pending.RequestID == "" || pending.ExpiresInMs != 120000 {
		t.Fatalf("got %+v", pending)
	}
	if got := broker.Approve(pending.RequestID); got != PairingActionResolved {
		t.Fatalf("approve: got %v", got)
	}

	paired := clientReceive(t, r)
	if paired.Kind != "paired" || paired.Token == "" {
		t.Fatalf("got %+v", paired)
	}
	ready := clientReceive(t, r)
	if ready.Kind != "ready" || ready.SessionID == "" {
		t.Fatalf("got %+v", ready)
	}
	if ok := <-done; !ok {
		t.Fatal("want ok=true after approval")
	}
	row, found, _ := store.ByID("c1")
	if !found || row.Label != "vscode" {
		t.Fatalf("row not inserted before paired sent: %+v found=%v", row, found)
	}
}

func TestHandshake_Row7_PairingDenied(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	broker := NewBroker(time.Now)
	deps := testHandshakeDeps(newFakeTrustStore(), broker, time.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"},
	})
	r := bufio.NewReader(client)
	pending := clientReceive(t, r)
	broker.Deny(pending.RequestID)

	resp := clientReceive(t, r)
	if resp.Kind != "pairingDenied" || resp.Reason != "denied" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false when denied")
	}
	if !broker.InCooldown("c1") {
		t.Fatal("deny must start a cooldown")
	}
}

func TestHandshake_Row7_PairingTimeout(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	clock := newFakeClock()
	broker := NewBroker(clock.Now)
	deps := testHandshakeDeps(newFakeTrustStore(), broker, clock.Now)

	done := make(chan bool, 1)
	go func() {
		_, ok := runHandshake(newConn(server), deps)
		done <- ok
	}()
	clientSend(t, client, helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "c1"},
	})
	r := bufio.NewReader(client)
	clientReceive(t, r) // pairingRequired

	clock.Advance(121 * time.Second)
	broker.ExpireOverdue()

	resp := clientReceive(t, r)
	if resp.Kind != "pairingDenied" || resp.Reason != "timeout" {
		t.Fatalf("got %+v", resp)
	}
	if ok := <-done; ok {
		t.Fatal("want ok=false on timeout")
	}
	if broker.InCooldown("c1") {
		t.Fatal("timeout must not start a cooldown")
	}
}
