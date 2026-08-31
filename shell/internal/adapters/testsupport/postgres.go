// Package testsupport is the Go analogue of tests/db/support/*.ts (A19): the Docker gate, real
// container startup, and seed-SQL loading each adapter's own acceptance spec needs. One container
// per test binary, started lazily on first call and reused by every later call in the same
// process — a fresh container per test would make the suite unusable (§11b).
package testsupport

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// DockerUnavailableMessage mirrors tests/db/support/docker.ts's own DOCKER_UNAVAILABLE_MESSAGE,
// re-pointed at this environment's own startup procedure (AGENTS.md's Docker section) rather than
// Colima's, since this is the Go test tier, not the dev machine's.
const DockerUnavailableMessage = "Docker daemon unreachable — see AGENTS.md's Docker section for " +
	"how to start it (nohup dockerd, or colima start on macOS) and retry."

const dockerProbeTimeout = 5 * time.Second

// IsDockerAvailable is docker.ts's isDockerAvailable.
func IsDockerAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), dockerProbeTimeout)
	defer cancel()
	return exec.CommandContext(ctx, "docker", "info").Run() == nil
}

// PgFixture is postgres.ts's PgFixture.
type PgFixture struct {
	URI       string
	Config    model.ResolvedConnectionConfig
	container testcontainers.Container
}

var pgMemo fixture[PgFixture]

// repoRoot resolves the repository root relative to this source file, so the seed SQL path does
// not depend on the test binary's own working directory.
func repoRoot() string {
	_, thisFile, _, _ := runtime.Caller(0)
	// this file: shell/internal/adapters/testsupport/postgres.go
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..")
}

const (
	image    = "postgres:17-alpine"
	password = "kira"
	database = "kira_test"
)

// StartPostgres is postgres.ts's startPostgres. Skips the test (never a silent pass, never a hard
// failure that makes go test ./internal/adapters/postgres unusable without Docker) when the
// daemon is unreachable.
//
// Memoized process-wide by fixture[T] (bun:test's own beforeAll/afterAll-per-file precedent,
// §11b/B15) — termination is deliberately NOT wired to any one test's t.Cleanup: see fixture.go's
// own doc comment for why. Call StopPostgres from the package's own TestMain instead.
func StartPostgres(t *testing.T) *PgFixture {
	t.Helper()
	if !IsDockerAvailable() {
		t.Skip(DockerUnavailableMessage)
	}
	fixture, err := pgMemo.get(startPostgres)
	if err != nil {
		t.Fatalf("postgres container: %v", err)
	}
	return fixture
}

// StopPostgres terminates the memoized container, if one was ever started. Call once, from the
// test binary's own TestMain, after m.Run() returns — never from an individual test.
func StopPostgres() {
	pgMemo.stop(func(f *PgFixture) { _ = f.container.Terminate(context.Background()) })
}

func startPostgres() (*PgFixture, error) {
	ctx := context.Background()

	// The same wait strategy P58a's own M0 probe confirmed working in this sandbox: Postgres logs
	// "database system is ready to accept connections" twice during initdb's own double-boot, and
	// waiting for the second occurrence is what @testcontainers/postgresql's own pg_isready-based
	// healthcheck solves on the TypeScript side — testcontainers-go's postgres module has no
	// equivalent built-in healthcheck, so this is spelled out explicitly here instead.
	container, err := tcpostgres.Run(ctx, image,
		tcpostgres.WithDatabase(database),
		tcpostgres.WithUsername("postgres"),
		tcpostgres.WithPassword(password),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(120*time.Second),
		),
	)
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, err
	}
	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return nil, err
	}
	uri := "postgres://postgres:" + password + "@" + host + ":" + port.Port() + "/" + database

	seedPath := filepath.Join(repoRoot(), "tests", "db", "fixtures", "0001_seed.sql")
	seedSQL, err := os.ReadFile(seedPath)
	if err != nil {
		return nil, err
	}
	if err := seedDatabase(ctx, uri, string(seedSQL)); err != nil {
		return nil, err
	}
	// postgres.ts's own start(): app.big_rows is created by the seed file but populated and
	// ANALYZEd separately (opts?.seedBigTable ?? true) — done unconditionally here since every one
	// of this package's own tests wants the real 1,000,000-row table, not the P1-only empty-table
	// shortcut the TS harness offers callers that don't need paging.
	if err := seedBigRows(ctx, uri); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	hostCopy, portInt := host, int(port.Num())
	cfg := model.ResolvedConnectionConfig{
		ID: "test-postgres", SortOrder: 0, CreatedAt: now, UpdatedAt: now,
		Name: "Test Postgres", Kind: "postgres", Color: "blue", Mode: "fields", ReadOnly: false,
		Host: &hostCopy, Port: &portInt, Database: Strp(database), Username: Strp("postgres"),
		Options: map[string]any{}, Password: Strp(password),
	}
	return &PgFixture{URI: uri, Config: cfg, container: container}, nil
}
