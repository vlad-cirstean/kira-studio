package memory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"

	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/memory/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const (
	defaultSearchLimit = 25
	maxSearchLimit     = 100
)

var errStale = errors.New("memory store changed concurrently; retry")

// Store is memory.db. Construction is free: the file opens on first use, so a host that never
// touches memory never creates it.
type Store struct {
	path string

	mu sync.Mutex
	db *sql.DB
}

func NewStore(path string) *Store { return &Store{path: path} }

// OpenDefault returns a Store at DefaultPath.
func OpenDefault() *Store { return NewStore(DefaultPath()) }

func (s *Store) conn() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db, nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return nil, fmt.Errorf("memory: create home: %w", err)
	}
	db, err := sqlitex.OpenImmediate(s.path)
	if err != nil {
		return nil, err
	}
	steps, err := migrations.All()
	if err == nil {
		err = sqlitex.Migrate(db, steps)
	}
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	s.db = db
	return db, nil
}

// DB returns the open memory.db handle, for internal/memory subpackages sharing the file.
func (s *Store) DB() (*sql.DB, error) { return s.conn() }

// Opened reports whether the file has been opened by this Store.
func (s *Store) Opened() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db != nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

type SearchArgs struct {
	Query          string
	IncludeHistory bool
	Limit          int // clamped to [1, 100]; 0 means 25
}

const memoryColumns = `m.id, m.lineage_id, m.version, m.fact, m.reason, m.keywords, m.author, m.status,
	m.supersedes_id, m.superseded_by_id, m.created_at, m.superseded_at,
	(SELECT count(*) FROM memories x WHERE x.lineage_id = m.lineage_id) AS versions, m.seq`

type rowScanner interface{ Scan(dest ...any) error }

func scanMemory(r rowScanner, extra ...any) (Memory, error) {
	var m Memory
	var kw string
	dest := append([]any{&m.ID, &m.LineageID, &m.Version, &m.Fact, &m.Reason, &kw, &m.Author, &m.Status,
		&m.SupersedesID, &m.SupersededBy, &m.CreatedAt, &m.SupersededAt, &m.Versions, &m.seq}, extra...)
	if err := r.Scan(dest...); err != nil {
		return Memory{}, err
	}
	m.Keywords = splitKeywords(kw)
	m.Historical = m.Status == StatusSuperseded
	return m, nil
}

func collect(rows *sql.Rows, withRank bool) ([]Memory, error) {
	defer rows.Close()
	out := []Memory{}
	for rows.Next() {
		var rank float64
		var m Memory
		var err error
		if withRank {
			m, err = scanMemory(rows, &rank)
		} else {
			m, err = scanMemory(rows)
		}
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func clampLimit(n int) int {
	switch {
	case n <= 0:
		return defaultSearchLimit
	case n > maxSearchLimit:
		return maxSearchLimit
	}
	return n
}

// searchFTS is the keyword half of search, recall-first (BuildMatch): bm25 orders results, nothing
// is cut by score. Service.Search fuses it with the vector list.
func (s *Store) searchFTS(ctx context.Context, a SearchArgs) ([]Memory, error) {
	match, ok := BuildMatch(a.Query)
	if !ok {
		return []Memory{}, nil
	}
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+memoryColumns+`, bm25(memories_fts, 10.0, 2.0, 4.0) AS rank
		FROM memories_fts JOIN memories m ON m.seq = memories_fts.rowid
		WHERE memories_fts MATCH ?1 AND (?2 OR m.status = 'current')
		ORDER BY rank, m.seq DESC
		LIMIT ?3`, match, a.IncludeHistory, clampLimit(a.Limit))
	if err != nil {
		return nil, fmt.Errorf("memory: search: %w", err)
	}
	return collect(rows, true)
}

// Recent lists current memories, newest first.
func (s *Store) Recent(ctx context.Context, limit int) ([]Memory, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+memoryColumns+` FROM memories m WHERE m.status = 'current'
		ORDER BY m.created_at DESC, m.seq DESC LIMIT ?`, clampLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("memory: recent: %w", err)
	}
	return collect(rows, false)
}

// Lineage returns every version of id's lineage (id may be any version) plus its events.
func (s *Store) Lineage(ctx context.Context, id string) (History, error) {
	db, err := s.conn()
	if err != nil {
		return History{}, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+memoryColumns+` FROM memories m
		WHERE m.lineage_id = (SELECT lineage_id FROM memories WHERE id = ?) ORDER BY m.version`, id)
	if err != nil {
		return History{}, fmt.Errorf("memory: lineage: %w", err)
	}
	mems, err := collect(rows, false)
	if err != nil {
		return History{}, err
	}
	if len(mems) == 0 {
		return History{}, ErrNotFound
	}
	erows, err := db.QueryContext(ctx, `SELECT e.seq, e.request_id, e.source, e.source_ref, COALESCE(f.rel_path, ''),
		e.action, e.lineage_id, e.memory_id, e.previous_id, e.author, e.rationale, e.created_at
		FROM memory_events e LEFT JOIN import_files f ON e.source = 'import' AND f.id = e.source_ref
		WHERE e.lineage_id = ? ORDER BY e.seq`, mems[0].LineageID)
	if err != nil {
		return History{}, fmt.Errorf("memory: events: %w", err)
	}
	defer erows.Close()
	h := History{Memories: mems, Events: []Event{}}
	for erows.Next() {
		var e Event
		if err := erows.Scan(&e.Seq, &e.RequestID, &e.Source, &e.SourceRef, &e.SourceLabel, &e.Action, &e.LineageID, &e.MemoryID,
			&e.PreviousID, &e.Author, &e.Rationale, &e.CreatedAt); err != nil {
			return History{}, err
		}
		h.Events = append(h.Events, e)
	}
	return h, erows.Err()
}

// ErrNotFound is returned when an id names no memory.
var ErrNotFound = errors.New("memory not found")

// currentByHash lists current memories whose normalized fact hashes to h.
func (s *Store) currentByHash(ctx context.Context, h string) ([]Memory, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+memoryColumns+` FROM memories m
		WHERE m.status = 'current' AND m.fact_hash = ?`, h)
	if err != nil {
		return nil, fmt.Errorf("memory: hash lookup: %w", err)
	}
	return collect(rows, false)
}

// Revision is the insert counter reconcile decisions are checked against at commit.
func (s *Store) Revision(ctx context.Context) (int64, error) {
	db, err := s.conn()
	if err != nil {
		return 0, err
	}
	return readRevision(ctx, db)
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func readRevision(ctx context.Context, q queryer) (int64, error) {
	var v int64
	if err := q.QueryRowContext(ctx, `SELECT value FROM memory_revision WHERE id = 1`).Scan(&v); err != nil {
		return 0, fmt.Errorf("memory: revision: %w", err)
	}
	return v, nil
}

// DataVersion changes whenever another connection (the MCP subprocess) commits.
func (s *Store) DataVersion(ctx context.Context) (int64, error) {
	db, err := s.conn()
	if err != nil {
		return 0, err
	}
	var v int64
	if err := db.QueryRowContext(ctx, `PRAGMA data_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("memory: data_version: %w", err)
	}
	return v, nil
}

type commitInput struct {
	Revision  int64
	Action    string
	TargetID  string // update/noop
	Fact      string
	Reason    string
	Keywords  []string
	Author    string
	Source    string
	SourceRef string // import file id; empty stores NULL
	RequestID string
	Why       string
	// Vec, when set, is the L2-normalised embedding of the inserted fact, stored in the same
	// transaction under Model. Noop ignores it.
	Vec   []byte
	Model string
}

type commitResult struct {
	ID, LineageID string
	Version       int
	PreviousID    string
	// Revision is the store revision after this commit, so a request's next fact can proceed
	// without mistaking its own insert for a concurrent writer.
	Revision int64
}

// commitFact applies one decision in one write transaction. errStale means the store changed
// since the decision was read; the caller reruns reconcile.
func (s *Store) commitFact(ctx context.Context, in commitInput) (commitResult, error) {
	db, err := s.conn()
	if err != nil {
		return commitResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return commitResult{}, fmt.Errorf("memory: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rev, err := readRevision(ctx, tx)
	if err != nil {
		return commitResult{}, err
	}
	if rev != in.Revision {
		return commitResult{}, errStale
	}
	now := kiratime.NowISO()
	var res commitResult
	switch in.Action {
	case ActionAdd:
		res.ID = uuid.NewString()
		res.LineageID, res.Version = res.ID, 1
		if err := insertMemory(ctx, tx, res, in, "", now); err != nil {
			return commitResult{}, err
		}
	case ActionUpdate:
		var lineage, status string
		var version int
		err := tx.QueryRowContext(ctx, `SELECT lineage_id, version, status FROM memories WHERE id = ?`, in.TargetID).
			Scan(&lineage, &version, &status)
		if err != nil || status != StatusCurrent {
			return commitResult{}, errStale
		}
		res = commitResult{ID: uuid.NewString(), LineageID: lineage, Version: version + 1, PreviousID: in.TargetID}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET status = 'superseded', superseded_at = ? WHERE id = ?`,
			now, in.TargetID); err != nil {
			return commitResult{}, fmt.Errorf("memory: supersede: %w", err)
		}
		if err := insertMemory(ctx, tx, res, in, in.TargetID, now); err != nil {
			return commitResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET superseded_by_id = ? WHERE id = ?`,
			res.ID, in.TargetID); err != nil {
			return commitResult{}, fmt.Errorf("memory: link superseded: %w", err)
		}
	case ActionNoop:
		var lineage string
		var version int
		if err := tx.QueryRowContext(ctx, `SELECT lineage_id, version FROM memories WHERE id = ?`, in.TargetID).
			Scan(&lineage, &version); err != nil {
			return commitResult{}, errStale
		}
		res = commitResult{ID: in.TargetID, LineageID: lineage, Version: version}
	default:
		return commitResult{}, fmt.Errorf("memory: unknown action %q", in.Action)
	}

	var prev, ref any
	if res.PreviousID != "" {
		prev = res.PreviousID
	}
	if in.SourceRef != "" {
		ref = in.SourceRef
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_events
		(request_id, source, source_ref, action, lineage_id, memory_id, previous_id, author, rationale, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.RequestID, in.Source, ref, in.Action, res.LineageID, res.ID, prev, in.Author, in.Why, now); err != nil {
		return commitResult{}, fmt.Errorf("memory: event: %w", err)
	}
	if res.Revision, err = readRevision(ctx, tx); err != nil {
		return commitResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return commitResult{}, fmt.Errorf("memory: commit: %w", err)
	}
	return res, nil
}

func insertMemory(ctx context.Context, tx *sql.Tx, r commitResult, in commitInput, supersedes, now string) error {
	var sup any
	if supersedes != "" {
		sup = supersedes
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO memories
		(id, lineage_id, version, fact, reason, keywords, author, status, supersedes_id, fact_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?)`,
		r.ID, r.LineageID, r.Version, in.Fact, in.Reason, joinKeywords(in.Keywords), in.Author, sup,
		factHash(in.Fact), now)
	if err != nil {
		return fmt.Errorf("memory: insert: %w", err)
	}
	if len(in.Vec) == 0 {
		return nil
	}
	seq, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("memory: insert: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO memory_embeddings (seq, model, vec, created_at)
		VALUES (?, ?, ?, ?)`, seq, in.Model, in.Vec, now); err != nil {
		return fmt.Errorf("memory: insert embedding: %w", err)
	}
	return nil
}
