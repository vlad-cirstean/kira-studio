package gitsock

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	flatbuffers "github.com/google/flatbuffers/go"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitwire"
)

// §3.9's own end-to-end proof of the whole history pipeline over a real socket: graph.stream
// chunk tiling and source transitions, credit backpressure, per-connection walk privacy, and the
// "KIG1" frame decoding to the repository's real shas in --topo-order (§7.1(e)) — plus D16's
// cross-language fixture capture and D22's opt-in perf probe.

// graphChunkPayload mirrors gitrpc's own unexported graphChunk envelope (wire.go) — duplicated
// here (a real client parses the wire, it does not import the server's own types) the same way
// this file's sibling integration_test.go already duplicates the frame/envelope shapes.
type graphChunkPayload struct {
	RepoID    string `json:"repoId"`
	Seq       int    `json:"seq"`
	From      int    `json:"from"`
	To        int    `json:"to"`
	Source    string `json:"source"`
	Remaining int    `json:"remaining"`
	Exhausted bool   `json:"exhausted"`
}

// initFixtureRepoWithCommits builds a repo with n sequential commits on main, returning their
// shas newest-first (git log's own default order — what --topo-order over --all reduces to on a
// single linear branch).
func initFixtureRepoWithCommits(t *testing.T, n int) (dir string, shasNewestFirst []string) {
	t.Helper()
	dir = t.TempDir()
	run := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	run("init", "-q", "-b", "main")
	shas := make([]string, n)
	for i := 0; i < n; i++ {
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte{byte(i)}, 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("add", "f.txt")
		run("commit", "-q", "-m", fmt.Sprintf("commit %d", i))
		shas[i] = trimNewline(run("rev-parse", "HEAD"))
	}
	for i, j := 0, len(shas)-1; i < j; i, j = i+1, j-1 {
		shas[i], shas[j] = shas[j], shas[i]
	}
	return dir, shas
}

func trimNewline(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

// buildFastImportRepo builds a repo with n sequential commits via `git fast-import`, orders of
// magnitude faster than n separate `git commit` spawns (D22's own reasoning) — needed both for a
// multi-chunk credit-backpressure fixture (>500 rows) and the opt-in perf probe.
func buildFastImportRepo(t *testing.T, n int) string {
	t.Helper()
	dir := t.TempDir()
	initCmd := exec.Command("git", "init", "-q", "-b", "main")
	initCmd.Dir = dir
	if out, err := initCmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}

	var script []byte
	const baseTime = int64(1700000000)
	for i := 1; i <= n; i++ {
		msg := fmt.Sprintf("commit %d", i)
		content := fmt.Sprintf("%d\n", i)
		script = fmt.Appendf(script, "commit refs/heads/main\n")
		script = fmt.Appendf(script, "mark :%d\n", i)
		script = fmt.Appendf(script, "author Test <test@example.com> %d +0000\n", baseTime+int64(i))
		script = fmt.Appendf(script, "committer Test <test@example.com> %d +0000\n", baseTime+int64(i))
		script = fmt.Appendf(script, "data %d\n%s\n", len(msg), msg)
		if i > 1 {
			script = fmt.Appendf(script, "from :%d\n", i-1)
		}
		script = fmt.Appendf(script, "M 100644 inline f.txt\n")
		script = fmt.Appendf(script, "data %d\n%s\n", len(content), content)
	}

	importCmd := exec.Command("git", "fast-import", "--quiet")
	importCmd.Dir = dir
	importCmd.Stdin = bytes.NewReader(script)
	if out, err := importCmd.CombinedOutput(); err != nil {
		t.Fatalf("git fast-import: %v\n%s", err, out)
	}
	checkoutCmd := exec.Command("git", "checkout", "-q", "main")
	checkoutCmd.Dir = dir
	if out, err := checkoutCmd.CombinedOutput(); err != nil {
		t.Fatalf("git checkout: %v\n%s", err, out)
	}
	return dir
}

// runnerFunc adapts a plain function to gitclient.Runner — what
// TestIntegration_GraphStreamResumesFromCache uses to count "git log" spawns without a named
// wrapper type.
type runnerFunc func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error)

func (f runnerFunc) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	return f(ctx, gitPath, spec)
}

// drainStreamToEnd reads frames from c until (and including) an 'end' frame, failing the test on
// a stream error.
func drainStreamToEnd(t *testing.T, c *testClient) []streamFrame {
	t.Helper()
	var chunks []streamFrame
	for {
		f := c.readStreamFrame()
		if f.Body.T == "end" {
			if f.Body.Error != nil {
				t.Fatalf("stream ended with error: %+v", f.Body.Error)
			}
			return chunks
		}
		if f.Body.T != "chunk" {
			t.Fatalf("frame = %+v, want chunk or end", f.Body)
		}
		chunks = append(chunks, f)
	}
}

func requestOK(t *testing.T, c *testClient, method string, params any) wireFrame {
	t.Helper()
	resp := c.request(method, params)
	if resp.T != "res" || resp.OK == nil || !*resp.OK {
		t.Fatalf("%s: got %+v", method, resp)
	}
	return resp
}

func graphStatusOK(t *testing.T, c *testClient, repoID string) graphStatusResult {
	t.Helper()
	resp := requestOK(t, c, "graph.status", map[string]any{"repoId": repoID})
	var result graphStatusResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		t.Fatalf("unmarshal graph.status result: %v", err)
	}
	return result
}

type graphStatusResult struct {
	Loaded    int  `json:"loaded"`
	Remaining int  `json:"remaining"`
	Exhausted bool `json:"exhausted"`
}

// decodePackedChunk decodes blob as a gitwire.Frame and returns its PackedCommitChunk payload.
func decodePackedChunk(t *testing.T, blob []byte) *gitwire.PackedCommitChunk {
	t.Helper()
	if !gitwire.FrameBufferHasIdentifier(blob) {
		t.Fatal("blob is missing the 'KIG1' file identifier")
	}
	frame := gitwire.GetRootAsFrame(blob, 0)
	if frame.PayloadType() != gitwire.PayloadPackedCommitChunk {
		t.Fatalf("frame payload type = %v, want PackedCommitChunk", frame.PayloadType())
	}
	var tab flatbuffers.Table
	if !frame.Payload(&tab) {
		t.Fatal("frame has no payload")
	}
	table := new(gitwire.PackedCommitChunk)
	table.Init(tab.Bytes, tab.Pos)
	return table
}

func shasFromChunk(table *gitwire.PackedCommitChunk) []string {
	width := int(table.ShaWidthBytes())
	raw := table.ShasBytes()
	if width == 0 || len(raw) == 0 {
		return nil
	}
	out := make([]string, len(raw)/width)
	for i := range out {
		out[i] = hex.EncodeToString(raw[i*width : (i+1)*width])
	}
	return out
}

func readUint32ColumnLE(raw []byte) []uint32 {
	out := make([]uint32, len(raw)/4)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(raw[i*4 : i*4+4])
	}
	return out
}

func TestIntegration_GraphStreamRendersAPage(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir, wantShas := initFixtureRepoWithCommits(t, 5)
	client := pairAndReady(t, server, sockPath, "stream-client")
	result := openRepoOK(t, client, repoDir)
	repoID := result.Repo.RepoID

	id := client.openStream("graph.stream", map[string]any{"repoId": repoID})
	client.sendCredit(id, 10)

	var gotShas []string
	wantSeq := 0
	for {
		f := client.readStreamFrame()
		if f.Body.T == "end" {
			if f.Body.Error != nil {
				t.Fatalf("stream ended with error: %+v", f.Body.Error)
			}
			break
		}
		if f.Body.T != "chunk" {
			t.Fatalf("frame = %+v, want chunk or end", f.Body)
		}
		if f.Blob == nil {
			t.Fatal("chunk frame carried no out-of-band blob")
		}
		if f.Body.Seq != wantSeq {
			t.Fatalf("seq = %d, want %d", f.Body.Seq, wantSeq)
		}
		wantSeq++

		var payload graphChunkPayload
		if err := json.Unmarshal(f.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		if payload.RepoID != repoID {
			t.Fatalf("chunk.repoId = %q, want %q", payload.RepoID, repoID)
		}
		if payload.Source != "git" {
			t.Fatalf("chunk.source = %q, want git", payload.Source)
		}
		if payload.From != len(gotShas) {
			t.Fatalf("chunk.From = %d, want %d (tiling in order)", payload.From, len(gotShas))
		}

		table := decodePackedChunk(t, f.Blob)
		gotShas = append(gotShas, shasFromChunk(table)...)
		if payload.To != len(gotShas) {
			t.Fatalf("chunk.To = %d, want %d after appending this chunk's shas", payload.To, len(gotShas))
		}
	}

	if !reflect.DeepEqual(gotShas, wantShas) {
		t.Fatalf("shas = %v, want %v (real shas, in --topo-order)", gotShas, wantShas)
	}
}

func TestIntegration_GraphStreamResumesFromCache(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	realRunner := gitclient.NewExecRunner()
	var logs int32
	countRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if len(spec.Args) > 0 && spec.Args[0] == "log" {
			atomic.AddInt32(&logs, 1)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})
	server, sockPath, _, _ := newIntegrationServerWithRunner(t, countRunner)
	// 600 rows over ChunkRows=500 gives the first stream two chunks ([0,500) and [500,600)), so
	// resuming at the marked boundary row 500 has a real cache range to replay — resuming at the
	// very end (n == the store's own row count) would legitimately produce zero chunks, which
	// would prove nothing about cache replay itself.
	repoDir := buildFastImportRepo(t, 600)
	client := pairAndReady(t, server, sockPath, "resume-client")
	result := openRepoOK(t, client, repoDir)
	repoID := result.Repo.RepoID

	id1 := client.openStream("graph.stream", map[string]any{"repoId": repoID})
	client.sendCredit(id1, 10)
	drainStreamToEnd(t, client)
	afterFirst := atomic.LoadInt32(&logs)
	if afterFirst == 0 {
		t.Fatal("expected at least one 'git log' spawn for the first stream")
	}

	id2 := client.openStream("graph.stream", map[string]any{"repoId": repoID, "resumeThroughRow": 500})
	client.sendCredit(id2, 10)
	chunks := drainStreamToEnd(t, client)
	if len(chunks) == 0 {
		t.Fatal("resumed stream produced no chunks, want the cached [500,600) range replayed")
	}
	for _, f := range chunks {
		var payload graphChunkPayload
		if err := json.Unmarshal(f.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		if payload.Source != "cache" {
			t.Fatalf("resumed chunk source = %q, want cache", payload.Source)
		}
	}
	if got := atomic.LoadInt32(&logs); got != afterFirst {
		t.Fatalf("'git log' spawns after a fully-cached resume = %d, want unchanged from %d", got, afterFirst)
	}
}

func TestIntegration_WalksArePrivatePerConnection(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir, wantShas := initFixtureRepoWithCommits(t, 5)
	clientA := pairAndReady(t, server, sockPath, "priv-a")
	clientB := pairAndReady(t, server, sockPath, "priv-b")
	resultA := openRepoOK(t, clientA, repoDir)
	resultB := openRepoOK(t, clientB, repoDir)
	repoID := resultA.Repo.RepoID
	if resultB.Repo.RepoID != repoID {
		t.Fatalf("clients opened the same repo but got different RepoIDs: %s vs %s", resultA.Repo.RepoID, resultB.Repo.RepoID)
	}

	requestOK(t, clientA, "graph.loadMore", map[string]any{"repoId": repoID, "pages": 1})
	statusA := graphStatusOK(t, clientA, repoID)
	if statusA.Loaded != len(wantShas) || !statusA.Exhausted {
		t.Fatalf("A status after its own loadMore = %+v, want fully loaded", statusA)
	}
	statusB := graphStatusOK(t, clientB, repoID)
	if statusB.Loaded != 0 || statusB.Remaining != 0 || statusB.Exhausted {
		t.Fatalf("B status = %+v, want the zero-value answer for a connection with no walk yet", statusB)
	}

	idB := clientB.openStream("graph.stream", map[string]any{"repoId": repoID})
	clientB.sendCredit(idB, 10)
	drainStreamToEnd(t, clientB)
	statusB2 := graphStatusOK(t, clientB, repoID)
	if statusB2.Loaded != len(wantShas) || !statusB2.Exhausted {
		t.Fatalf("B status after its own stream = %+v, want fully loaded", statusB2)
	}

	refreshResp := requestOK(t, clientA, "graph.refresh", map[string]any{"repoId": repoID})
	var refresh struct {
		Restarted bool `json:"restarted"`
	}
	if err := json.Unmarshal(refreshResp.Result, &refresh); err != nil {
		t.Fatalf("unmarshal graph.refresh result: %v", err)
	}
	if !refresh.Restarted {
		t.Fatal("A's graph.refresh: want restarted=true (A has a walk)")
	}

	// B's own walk must be untouched by A's refresh -- a resumed stream still replays from cache.
	idB2 := clientB.openStream("graph.stream", map[string]any{"repoId": repoID, "resumeThroughRow": len(wantShas)})
	clientB.sendCredit(idB2, 10)
	for _, f := range drainStreamToEnd(t, clientB) {
		var payload graphChunkPayload
		if err := json.Unmarshal(f.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		if payload.Source != "cache" {
			t.Fatalf("B chunk source = %q after A's own refresh, want cache -- B's walk must be untouched", payload.Source)
		}
	}
}

func TestIntegration_CreditsApplyBackpressure(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir := buildFastImportRepo(t, 1200) // > 2 * ChunkRows(500): at least 3 wire chunks.
	client := pairAndReady(t, server, sockPath, "credit-client")
	result := openRepoOK(t, client, repoDir)
	repoID := result.Repo.RepoID

	id := client.openStream("graph.stream", map[string]any{"repoId": repoID})
	client.sendCredit(id, 2)

	for i := 0; i < 2; i++ {
		f := client.readStreamFrame()
		if f.Body.T != "chunk" {
			t.Fatalf("frame %d = %+v, want chunk", i, f.Body)
		}
	}

	frameCh := make(chan streamFrame, 1)
	go func() { frameCh <- client.readStreamFrame() }()
	select {
	case f := <-frameCh:
		t.Fatalf("received a third frame without granting more credit: %+v", f.Body)
	case <-time.After(300 * time.Millisecond):
	}

	client.sendCredit(id, 1)
	select {
	case f := <-frameCh:
		if f.Body.T != "chunk" {
			t.Fatalf("frame after the extra credit = %+v, want chunk", f.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no frame arrived after granting one more credit")
	}
}

// The three graph.* methods' own `range` handling (D14's own refusal, superseded G6 -- a `range`
// is now served against the review walk) is proven in review_test.go, over a real ranged review.

// TestFixtures_CaptureGraphChunkFrame is D16's own regenerator — the golden fixture proving the
// Go encoder and the TypeScript decoder (socketChannel.test.ts) agree, byte for byte.
func TestFixtures_CaptureGraphChunkFrame(t *testing.T) {
	if os.Getenv("KIRA_GIT_FIXTURES") != "write" {
		t.Skip("set KIRA_GIT_FIXTURES=write to regenerate the golden corpus")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir, _ := initFixtureRepoWithCommits(t, 3)
	client := pairAndReady(t, server, sockPath, "fixture-client")
	result := openRepoOK(t, client, repoDir)
	repoID := result.Repo.RepoID

	id := client.openStream("graph.stream", map[string]any{"repoId": repoID})
	client.sendCredit(id, 2)

	raw, err := readFrame(client.r)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	if len(raw) == 0 || raw[0] != 0x00 {
		t.Fatalf("first chunk frame is not a blob frame: %v", raw)
	}
	headerLen := binary.BigEndian.Uint32(raw[1:5])
	header := raw[5 : 5+int(headerLen)]
	blob := raw[5+int(headerLen):]

	var env wireEnvelope
	if err := json.Unmarshal(header, &env); err != nil {
		t.Fatalf("unmarshal header: %v", err)
	}
	var payload graphChunkPayload
	if err := json.Unmarshal(env.Body.Chunk, &payload); err != nil {
		t.Fatalf("unmarshal chunk payload: %v", err)
	}
	if payload.RepoID != repoID {
		t.Fatalf("chunk.repoId = %q, want %q", payload.RepoID, repoID)
	}

	table := decodePackedChunk(t, blob)
	fixture := fixtureFile{
		Envelope: fixtureEnvelope{
			RepoID: payload.RepoID, Seq: payload.Seq, From: payload.From, To: payload.To,
			Source: payload.Source, Remaining: payload.Remaining, Exhausted: payload.Exhausted,
		},
		Commits: packedChunkToFixture(table),
	}

	outDir := filepath.Join("..", "..", "..", "..", "packages", "git-ipc", "testdata")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", outDir, err)
	}
	if err := os.WriteFile(filepath.Join(outDir, "graphChunkFrame.bin"), raw, 0o644); err != nil {
		t.Fatalf("write graphChunkFrame.bin: %v", err)
	}
	jsonBytes, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	jsonBytes = append(jsonBytes, '\n')
	if err := os.WriteFile(filepath.Join(outDir, "graphChunkFrame.json"), jsonBytes, 0o644); err != nil {
		t.Fatalf("write graphChunkFrame.json: %v", err)
	}
	t.Logf("captured graphChunkFrame.bin (%d bytes)", len(raw))
}

type fixtureEnvelope struct {
	RepoID    string `json:"repoId"`
	Seq       int    `json:"seq"`
	From      int    `json:"from"`
	To        int    `json:"to"`
	Source    string `json:"source"`
	Remaining int    `json:"remaining"`
	Exhausted bool   `json:"exhausted"`
}

type fixtureDecorationRef struct {
	Kind   string `json:"kind"`
	Name   string `json:"name,omitempty"`
	IsHead bool   `json:"isHead,omitempty"`
}

type fixtureRowDecorations struct {
	Row  int                    `json:"row"`
	Refs []fixtureDecorationRef `json:"refs"`
}

type fixturePackedChunk struct {
	From           int                     `json:"from"`
	To             int                     `json:"to"`
	ShaWidthBytes  int                     `json:"shaWidthBytes"`
	Shas           []string                `json:"shas"`
	ParentOffsets  []uint32                `json:"parentOffsets"`
	ParentShas     []string                `json:"parentShas"`
	IdentityIds    []uint32                `json:"identityIds"`
	Times          []uint32                `json:"times"`
	Subjects       []string                `json:"subjects"`
	SubjectOffsets []uint32                `json:"subjectOffsets"`
	DictionaryBase uint32                  `json:"dictionaryBase"`
	Dictionary     []string                `json:"dictionary"`
	Decorations    []fixtureRowDecorations `json:"decorations"`
}

type fixtureFile struct {
	Envelope fixtureEnvelope    `json:"envelope"`
	Commits  fixturePackedChunk `json:"commits"`
}

func packedChunkToFixture(table *gitwire.PackedCommitChunk) fixturePackedChunk {
	shaWidth := int(table.ShaWidthBytes())
	shas := shasFromChunk(table)
	rows := len(shas)

	parentOffsets := readUint32ColumnLE(table.ParentOffsetsBytes())
	parentShasRaw := table.ParentShasBytes()
	var parentShas []string
	if shaWidth > 0 {
		parentShas = make([]string, len(parentShasRaw)/shaWidth)
		for i := range parentShas {
			parentShas[i] = hex.EncodeToString(parentShasRaw[i*shaWidth : (i+1)*shaWidth])
		}
	}

	identityIds := readUint32ColumnLE(table.IdentityIdsBytes())
	times := readUint32ColumnLE(table.TimesBytes())
	subjectOffsets := readUint32ColumnLE(table.SubjectOffsetsBytes())
	subjectBytes := table.SubjectBytesBytes()
	subjects := make([]string, rows)
	for i := 0; i < rows; i++ {
		subjects[i] = string(subjectBytes[subjectOffsets[i]:subjectOffsets[i+1]])
	}

	dictionary := make([]string, table.DictionaryLength())
	for i := range dictionary {
		dictionary[i] = string(table.Dictionary(i))
	}

	decorations := make([]fixtureRowDecorations, table.DecorationsLength())
	for i := range decorations {
		var rd gitwire.RowDecorations
		table.Decorations(&rd, i)
		refs := make([]fixtureDecorationRef, rd.RefsLength())
		for j := range refs {
			var ref gitwire.DecorationRef
			rd.Refs(&ref, j)
			refs[j] = fixtureDecorationRef{Kind: string(ref.Kind()), Name: string(ref.Name()), IsHead: ref.IsHead()}
		}
		decorations[i] = fixtureRowDecorations{Row: int(rd.Row()), Refs: refs}
	}

	return fixturePackedChunk{
		From: int(table.From()), To: int(table.To()), ShaWidthBytes: shaWidth,
		Shas: shas, ParentOffsets: parentOffsets, ParentShas: parentShas,
		IdentityIds: identityIds, Times: times, Subjects: subjects, SubjectOffsets: subjectOffsets,
		DictionaryBase: table.DictionaryBase(), Dictionary: dictionary, Decorations: decorations,
	}
}

// TestGraphStreamPerf is D22's opt-in probe: numbers recorded, nothing asserted.
func TestGraphStreamPerf(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	if os.Getenv("KIRA_GIT_PERF") != "1" {
		t.Skip("set KIRA_GIT_PERF=1 to run the perf probe")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	const n = 20000
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir := buildFastImportRepo(t, n)
	client := pairAndReady(t, server, sockPath, "perf-client")
	result := openRepoOK(t, client, repoDir)
	repoID := result.Repo.RepoID

	start := time.Now()
	id := client.openStream("graph.stream", map[string]any{"repoId": repoID})
	client.sendCredit(id, n/500+10)

	var firstChunkAt time.Duration
	var chunkCount, totalBytes int
	for {
		f := client.readStreamFrame()
		if f.Body.T == "end" {
			if f.Body.Error != nil {
				t.Fatalf("stream ended with error: %+v", f.Body.Error)
			}
			break
		}
		if chunkCount == 0 {
			firstChunkAt = time.Since(start)
		}
		chunkCount++
		totalBytes += len(f.Blob)
	}
	total := time.Since(start)
	meanBytes := 0
	if chunkCount > 0 {
		meanBytes = totalBytes / chunkCount
	}
	t.Logf(
		"TestGraphStreamPerf: n=%d chunks=%d firstChunk=%s total=%s meanBytesPerChunk=%d totalBytes=%d",
		n, chunkCount, firstChunkAt, total, meanBytes, totalBytes,
	)
}
