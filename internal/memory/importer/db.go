package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/kirathecat/kira-studio/internal/memory"
)

const interruptedReason = "Interrupted: the import runner stopped during the import. Resume to continue."

// store is every SQL statement of the importer. Each method is one short transaction; the shared
// handle has a single connection, so never hold rows open while calling another method.
type store struct {
	db  *sql.DB
	now func() string
}

type usage struct {
	Calls   int
	CostUSD float64
}

func (s *store) tx(fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("import: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("import: commit: %w", err)
	}
	return nil
}

func rowsAffected(res sql.Result) int64 {
	n, _ := res.RowsAffected()
	return n
}

// CreateArgs describes a new import job. Provenance may be the zero value for UI jobs, which choose
// it at Start; MCP jobs always carry it.
type CreateArgs struct {
	Paths      []string
	Channel    string // ChannelUI (default) or ChannelMCP
	Provenance Provenance
	Groups     []memory.GroupRef
	// AutoStart makes the runner start the job once its scan ends, unless the estimate is over the cap.
	AutoStart bool
	WriteDoc  bool
}

// maxActiveMCPJobs bounds the jobs agents may have open at once (scanning, awaiting, running, paused).
const maxActiveMCPJobs = 5

// createJob inserts a scanning job and returns its id. An MCP job whose roots, provenance, groups and
// write-back match an active one returns that job's id instead (a repeated call is idempotent) and a
// sixth active MCP job is refused.
func (s *store) createJob(id string, a CreateArgs) (string, error) {
	raw, _ := json.Marshal(a.Paths)
	groups, _ := json.Marshal(nonNil(a.Groups))
	p := a.Provenance
	if p.Origin == "" {
		p = DefaultProvenance
	}
	channel := a.Channel
	if channel == "" {
		channel = ChannelUI
	}
	out := id
	err := s.tx(func(tx *sql.Tx) error {
		if channel == ChannelMCP {
			if same, err := activeTwin(tx, a.Paths, p, string(groups), a.WriteDoc); err != nil || same != "" {
				out = same
				return err
			}
		}
		_, err := tx.Exec(`INSERT INTO import_jobs
			(id, roots, base, state, created_at, channel, origin, source_tag, scope, project, session_id, groups_json, auto_start, write_doc)
			VALUES (?, ?, '', 'scanning', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, string(raw), s.now(), channel, p.Origin, nullable(p.SourceTag), p.Scope, nullable(p.Project), nullable(p.Session),
			string(groups), a.AutoStart, a.WriteDoc)
		return err
	})
	return out, err
}

// activeTwin returns the id of an active MCP job asking for exactly this, or "" after checking the
// active-job cap.
func activeTwin(tx *sql.Tx, paths []string, p Provenance, groups string, writeDoc bool) (string, error) {
	rows, err := tx.Query(`SELECT id, roots, origin, COALESCE(source_tag, ''), scope, COALESCE(project, ''), COALESCE(session_id, ''),
		groups_json, write_doc FROM import_jobs WHERE channel = 'mcp' AND state IN ('scanning', 'awaiting', 'running', 'paused')`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	want := slices.Sorted(slices.Values(paths))
	active := 0
	for rows.Next() {
		var id, roots, g string
		var q Provenance
		var w bool
		if err := rows.Scan(&id, &roots, &q.Origin, &q.SourceTag, &q.Scope, &q.Project, &q.Session, &g, &w); err != nil {
			return "", err
		}
		active++
		var have []string
		_ = json.Unmarshal([]byte(roots), &have)
		slices.Sort(have)
		if q == p && g == groups && w == writeDoc && slices.Equal(have, want) {
			return id, nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if active >= maxActiveMCPJobs {
		return "", fmt.Errorf("%w: Too many ingest jobs; wait or cancel one in Kira Space", memory.ErrInvalid)
	}
	return "", nil
}

func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func (s *store) failScan(id, reason string) error {
	_, err := s.db.Exec(`UPDATE import_jobs SET state = 'failed', reason = ? WHERE id = ? AND state = 'scanning'`, reason, id)
	return err
}

type newFile struct {
	ID, Path, Rel, Kind, Hash, State, Reason, Title string
	Size                                            int64
	Chunks, Tokens                                  int
}

// scanned stores a finished scan and moves the job to awaiting, then applies the agent auto-start
// rule in the same transaction so no reader sees an awaiting job that is about to start or whose
// confirmation reason is not yet set.
func (s *store) scanned(jobID, base string, truncated bool, ignored int, files []newFile, chunkCap int) error {
	return s.tx(func(tx *sql.Tx) error {
		tokens, chunks := 0, 0
		now := s.now()
		for _, f := range files {
			if _, err := tx.Exec(`INSERT INTO import_files
				(id, job_id, path, rel_path, kind, size, content_hash, state, reason, title, chunk_count, est_tokens, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				f.ID, jobID, f.Path, f.Rel, f.Kind, f.Size, f.Hash, f.State, f.Reason, f.Title, f.Chunks, f.Tokens, now); err != nil {
				return fmt.Errorf("import: insert file: %w", err)
			}
			if f.State == FilePending {
				tokens += f.Tokens
				chunks += f.Chunks
			}
		}
		res, err := tx.Exec(`UPDATE import_jobs SET state = 'awaiting', base = ?, truncated = ?, ignored_count = ?,
			est_tokens = ?, est_chunks = ? WHERE id = ? AND state = 'scanning'`, base, truncated, ignored, tokens, chunks, jobID)
		if err != nil {
			return err
		}
		if rowsAffected(res) == 0 {
			return errors.New("import: job left scanning state")
		}
		_, err = autoStartTx(tx, s.now, jobID, chunkCap)
		return err
	})
}

// moveJob changes a job's state when it is in one of from; otherwise it reports why not.
func (s *store) moveJob(tx *sql.Tx, id string, from []string, set string, args ...any) error {
	q := `UPDATE import_jobs SET ` + set + ` WHERE id = ? AND state IN (` + placeholders(len(from)) + `)`
	all := append(append([]any{}, args...), id)
	for _, f := range from {
		all = append(all, f)
	}
	res, err := tx.Exec(q, all...)
	if err != nil {
		return err
	}
	if rowsAffected(res) > 0 {
		return nil
	}
	return jobStateError(tx, id)
}

func jobStateError(tx *sql.Tx, id string) error {
	var state string
	switch err := tx.QueryRow(`SELECT state FROM import_jobs WHERE id = ?`, id).Scan(&state); {
	case errors.Is(err, sql.ErrNoRows):
		return ErrNotFound
	case err != nil:
		return err
	}
	return invalidState("import", state)
}

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }

// StartArgs set the provenance and write-back of an awaiting job at Start; nil keeps the job's own.
type StartArgs struct {
	Provenance *Provenance
	WriteDoc   *bool
}

func (s *store) startJob(id string, a StartArgs) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := s.moveJob(tx, id, []string{JobAwaiting}, `state = 'running', reason = '', started_at = ?`, s.now()); err != nil {
			return err
		}
		if a.WriteDoc != nil {
			if _, err := tx.Exec(`UPDATE import_jobs SET write_doc = ? WHERE id = ?`, *a.WriteDoc, id); err != nil {
				return err
			}
		}
		if a.Provenance == nil {
			return nil
		}
		p := *a.Provenance
		if _, err := tx.Exec(`UPDATE import_jobs SET origin = ?, source_tag = ?, scope = ?, project = ? WHERE id = ?`,
			p.Origin, nullable(p.SourceTag), p.Scope, nullable(p.Project), id); err != nil {
			return fmt.Errorf("%w: %v", memory.ErrInvalid, err)
		}
		// Files skipped as unchanged were judged under the scan's provenance; materialising rechecks them.
		_, err := tx.Exec(`UPDATE import_files SET state = 'pending', reason = '', updated_at = ?
			WHERE job_id = ? AND state = 'skipped' AND reason LIKE 'unchanged since import%'`, s.now(), id)
		return err
	})
}

// autoStartTx runs an awaiting MCP job whose scan found work within the chunk cap; over it, the job
// keeps waiting with the reason. It reports whether the job started.
func autoStartTx(tx *sql.Tx, now func() string, id string, chunkCap int) (bool, error) {
	var chunks int
	var auto bool
	err := tx.QueryRow(`SELECT est_chunks, auto_start FROM import_jobs WHERE id = ? AND state = 'awaiting'`, id).Scan(&chunks, &auto)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !auto) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if chunks > chunkCap {
		counts, err := pendingChunkCounts(tx, id)
		if err != nil {
			return false, err
		}
		_, err = tx.Exec(`UPDATE import_jobs SET reason = ? WHERE id = ?`,
			fmt.Sprintf("Needs confirmation in Kira Space: %d chunks, about %d calls", chunks, EstimateWork(counts, 0).Calls), id)
		return false, err
	}
	_, err = tx.Exec(`UPDATE import_jobs SET state = 'running', reason = '', started_at = ? WHERE id = ?`, now(), id)
	return err == nil, err
}

func pendingChunkCounts(tx *sql.Tx, jobID string) ([]int, error) {
	rows, err := tx.Query(`SELECT chunk_count FROM import_files WHERE job_id = ? AND state = 'pending'`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var counts []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		counts = append(counts, n)
	}
	return counts, rows.Err()
}

type activeJob struct {
	ID, State string
	Roots     []string
}

// activeJobs lists the jobs a runner works on: scanning and running.
func (s *store) activeJobs() ([]activeJob, error) {
	rows, err := s.db.Query(`SELECT id, state, roots FROM import_jobs WHERE state IN ('scanning', 'running') ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []activeJob
	for rows.Next() {
		var j activeJob
		var roots string
		if err := rows.Scan(&j.ID, &j.State, &roots); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(roots), &j.Roots)
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *store) hasActiveJobs() (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT count(*) FROM import_jobs WHERE state IN ('scanning', 'running')`).Scan(&n)
	return n > 0, err
}

func (s *store) failJob(id, reason string) error {
	_, err := s.db.Exec(`UPDATE import_jobs SET state = 'failed', reason = ?, finished_at = ? WHERE id = ? AND state IN ('scanning', 'running')`,
		reason, s.now(), id)
	return err
}

func (s *store) resumeJob(id string) error {
	return s.tx(func(tx *sql.Tx) error {
		return s.moveJob(tx, id, []string{JobPaused}, `state = 'running', reason = ''`)
	})
}

// pauseIfRunning reports whether the job was running.
func (s *store) pauseIfRunning(id, reason string) (bool, error) {
	var paused bool
	err := s.tx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE import_jobs SET state = 'paused', reason = ? WHERE id = ? AND state = 'running'`, reason, id)
		paused = err == nil && rowsAffected(res) > 0
		return err
	})
	return paused, err
}

func (s *store) pause(id, reason string) error {
	return s.tx(func(tx *sql.Tx) error {
		return s.moveJob(tx, id, []string{JobRunning}, `state = 'paused', reason = ?`, reason)
	})
}

func (s *store) cancelJob(id string) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := s.moveJob(tx, id, []string{JobRunning, JobPaused}, `state = 'cancelled', finished_at = ?`, s.now()); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE import_files SET state = 'cancelled', updated_at = ?
			WHERE job_id = ? AND state IN ('pending', 'extracting', 'extracted', 'verifying', 'finalizing')`, s.now(), id); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM import_chunks WHERE file_id IN
			(SELECT id FROM import_files WHERE job_id = ? AND state = 'cancelled')`, id)
		return err
	})
}

func (s *store) discardJob(id string) error {
	return s.tx(func(tx *sql.Tx) error {
		var state string
		switch err := tx.QueryRow(`SELECT state FROM import_jobs WHERE id = ?`, id).Scan(&state); {
		case errors.Is(err, sql.ErrNoRows):
			return ErrNotFound
		case err != nil:
			return err
		}
		if state != JobAwaiting {
			return invalidState("import", state)
		}
		_, err := tx.Exec(`DELETE FROM import_jobs WHERE id = ?`, id)
		return err
	})
}

func (s *store) dismissJob(id string) error {
	return s.tx(func(tx *sql.Tx) error {
		return s.moveJob(tx, id, []string{JobDone, JobCancelled, JobFailed}, `dismissed_at = ?`, s.now())
	})
}

// retryFile puts a failed file back to work: its failed chunks to pending, or, when only the
// finalize step failed, the file back to extracted. A finished job runs again.
func (s *store) retryFile(fileID string) (jobID string, err error) {
	err = s.tx(func(tx *sql.Tx) error {
		var state string
		switch e := tx.QueryRow(`SELECT job_id, state FROM import_files WHERE id = ?`, fileID).Scan(&jobID, &state); {
		case errors.Is(e, sql.ErrNoRows):
			return ErrNotFound
		case e != nil:
			return e
		}
		if state != FileFailed {
			return invalidState("file", state)
		}
		return s.retryFileTx(tx, jobID, fileID)
	})
	return jobID, err
}

func (s *store) retryFileTx(tx *sql.Tx, jobID, fileID string) error {
	var jobState string
	if err := tx.QueryRow(`SELECT state FROM import_jobs WHERE id = ?`, jobID).Scan(&jobState); err != nil {
		return err
	}
	if jobState != JobRunning && jobState != JobPaused && jobState != JobDone {
		return invalidState("import", jobState)
	}
	var failedChunks int
	if err := tx.QueryRow(`SELECT count(*) FROM import_chunks WHERE file_id = ? AND state != 'done'`, fileID).Scan(&failedChunks); err != nil {
		return err
	}
	var chunks int
	if err := tx.QueryRow(`SELECT count(*) FROM import_chunks WHERE file_id = ?`, fileID).Scan(&chunks); err != nil {
		return err
	}
	next := FileExtracted
	if chunks == 0 {
		next = FilePending // failed before it had chunks (unreadable, invalid JSON, bad memdoc): start over
	} else if failedChunks > 0 {
		next = FileExtracting
		if _, err := tx.Exec(`UPDATE import_chunks SET state = 'pending', attempts = 0, error = '' WHERE file_id = ? AND state != 'done'`, fileID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE import_files SET state = ?, reason = '', finalize_attempts = 0, updated_at = ? WHERE id = ?`,
		next, s.now(), fileID); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE import_jobs SET state = 'running', reason = '', finished_at = NULL WHERE id = ? AND state = 'done'`, jobID)
	return err
}

// retryFailed retries every failed file of a job and reports how many.
func (s *store) retryFailed(jobID string) (n int, err error) {
	err = s.tx(func(tx *sql.Tx) error {
		var state string
		switch e := tx.QueryRow(`SELECT state FROM import_jobs WHERE id = ?`, jobID).Scan(&state); {
		case errors.Is(e, sql.ErrNoRows):
			return ErrNotFound
		case e != nil:
			return e
		}
		rows, e := tx.Query(`SELECT id FROM import_files WHERE job_id = ? AND state = 'failed'`, jobID)
		if e != nil {
			return e
		}
		var ids []string
		for rows.Next() {
			var id string
			if e := rows.Scan(&id); e != nil {
				_ = rows.Close()
				return e
			}
			ids = append(ids, id)
		}
		_ = rows.Close()
		if len(ids) == 0 {
			return invalidState("import", state+" with no failed files")
		}
		for _, id := range ids {
			if e := s.retryFileTx(tx, jobID, id); e != nil {
				return e
			}
		}
		n = len(ids)
		return nil
	})
	return n, err
}

// recoverInterrupted resets what a crash or quit left mid-flight. It never resumes anything.
func (s *store) recoverInterrupted() error {
	return s.tx(func(tx *sql.Tx) error {
		for _, q := range []string{
			`UPDATE import_chunks SET state = 'pending' WHERE state = 'running'`,
			`UPDATE import_files SET state = 'extracted' WHERE state IN ('verifying', 'finalizing')`,
			`UPDATE import_files SET state = 'pending' WHERE state = 'extracting'
				AND NOT EXISTS (SELECT 1 FROM import_chunks c WHERE c.file_id = import_files.id)`,
		} {
			if _, err := tx.Exec(q); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE import_jobs SET state = 'paused', reason = ? WHERE state = 'running'`, interruptedReason)
		return err
	})
}

type fileRef struct {
	JobID, FileID, Path, Rel, Kind, Hash string
}

// nextPendingFile reserves the next pending file of a running job for materialising.
func (s *store) nextPendingFile() (fileRef, bool, error) {
	var ref fileRef
	found := false
	err := s.tx(func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT f.job_id, f.id, f.path, f.rel_path, f.kind, f.content_hash FROM import_files f
			JOIN import_jobs j ON j.id = f.job_id
			WHERE f.state = 'pending' AND j.state = 'running'
			ORDER BY j.created_at, f.rel_path LIMIT 1`).
			Scan(&ref.JobID, &ref.FileID, &ref.Path, &ref.Rel, &ref.Kind, &ref.Hash)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		_, err = tx.Exec(`UPDATE import_files SET state = 'extracting', updated_at = ? WHERE id = ?`, s.now(), ref.FileID)
		return err
	})
	return ref, found, err
}

// storeChunks records a materialised file's chunks. It does nothing when the file left extracting
// meanwhile (cancelled).
func (s *store) storeChunks(fileID, hash, title string, chunks []Chunk) error {
	return s.tx(func(tx *sql.Tx) error {
		tokens := 0
		for _, c := range chunks {
			tokens += c.Tokens
		}
		res, err := tx.Exec(`UPDATE import_files SET content_hash = ?, title = ?, chunk_count = ?, est_tokens = ?, updated_at = ?
			WHERE id = ? AND state = 'extracting'`, hash, title, len(chunks), tokens, s.now(), fileID)
		if err != nil || rowsAffected(res) == 0 {
			return err
		}
		for _, c := range chunks {
			if _, err := tx.Exec(`INSERT INTO import_chunks (file_id, idx, heading_path, context, text, tokens, state)
				VALUES (?, ?, ?, ?, ?, ?, 'pending')`, fileID, c.Index, c.HeadingPath, c.Context, c.Text, c.Tokens); err != nil {
				return fmt.Errorf("import: insert chunk: %w", err)
			}
		}
		return nil
	})
}

// endFile moves a file from one of from to state with a reason.
func (s *store) endFile(fileID string, from []string, state, reason string) error {
	return s.tx(func(tx *sql.Tx) error {
		q := `UPDATE import_files SET state = ?, reason = ?, updated_at = ? WHERE id = ? AND state IN (` + placeholders(len(from)) + `)`
		args := make([]any, 0, 4+len(from))
		args = append(args, state, reason, s.now(), fileID)
		for _, f := range from {
			args = append(args, f)
		}
		_, err := tx.Exec(q, args...)
		return err
	})
}

type chunkItem struct {
	JobID, FileID, Path, Title string
	Index, Count               int
	HeadingPath, Context, Text string
}

func (s *store) claimChunk() (chunkItem, bool, error) {
	var it chunkItem
	found := false
	err := s.tx(func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT f.job_id, c.file_id, f.rel_path, f.title, c.idx, f.chunk_count, c.heading_path, c.context, c.text
			FROM import_chunks c JOIN import_files f ON f.id = c.file_id JOIN import_jobs j ON j.id = f.job_id
			WHERE c.state = 'pending' AND f.state = 'extracting' AND j.state = 'running'
			ORDER BY j.created_at, f.rel_path, c.idx LIMIT 1`).
			Scan(&it.JobID, &it.FileID, &it.Path, &it.Title, &it.Index, &it.Count, &it.HeadingPath, &it.Context, &it.Text)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		_, err = tx.Exec(`UPDATE import_chunks SET state = 'running' WHERE file_id = ? AND idx = ?`, it.FileID, it.Index)
		return err
	})
	return it, found, err
}

func addUsage(tx *sql.Tx, jobID, fileID string, u usage) error {
	if _, err := tx.Exec(`UPDATE import_jobs SET calls = calls + ?, cost_usd = cost_usd + ? WHERE id = ?`, u.Calls, u.CostUSD, jobID); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE import_files SET cost_usd = cost_usd + ? WHERE id = ?`, u.CostUSD, fileID)
	return err
}

// finishChunk stores a chunk's facts. When it was the file's last open chunk, the file becomes
// extracted. A chunk no longer running (cancelled) changes nothing but the usage totals.
func (s *store) finishChunk(it chunkItem, facts []Fact, tries int, u usage) error {
	raw, err := json.Marshal(facts)
	if err != nil {
		return err
	}
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		res, err := tx.Exec(`UPDATE import_chunks SET state = 'done', facts = ?, attempts = attempts + ?, cost_usd = cost_usd + ?, error = ''
			WHERE file_id = ? AND idx = ? AND state = 'running'`, string(raw), tries, u.CostUSD, it.FileID, it.Index)
		if err != nil || rowsAffected(res) == 0 {
			return err
		}
		if _, err := tx.Exec(`UPDATE import_files SET fact_count = fact_count + ?, updated_at = ? WHERE id = ?`, len(facts), s.now(), it.FileID); err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE import_files SET state = 'extracted', updated_at = ? WHERE id = ? AND state = 'extracting'
			AND NOT EXISTS (SELECT 1 FROM import_chunks WHERE file_id = ? AND state != 'done')`, s.now(), it.FileID, it.FileID)
		return err
	})
}

func (s *store) failChunk(it chunkItem, msg string, tries int, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		res, err := tx.Exec(`UPDATE import_chunks SET state = 'failed', error = ?, attempts = attempts + ?, cost_usd = cost_usd + ?
			WHERE file_id = ? AND idx = ? AND state = 'running'`, msg, tries, u.CostUSD, it.FileID, it.Index)
		if err != nil || rowsAffected(res) == 0 {
			return err
		}
		_, err = tx.Exec(`UPDATE import_files SET state = 'failed', reason = ?, updated_at = ? WHERE id = ? AND state = 'extracting'`,
			fmt.Sprintf("Chunk %d of %d: %s", it.Index+1, it.Count, msg), s.now(), it.FileID)
		return err
	})
}

func (s *store) releaseChunk(it chunkItem, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE import_chunks SET state = 'pending' WHERE file_id = ? AND idx = ? AND state = 'running'`, it.FileID, it.Index)
		return err
	})
}

// finalItem is one extracted file claimed for its verify or finalize step. Facts carry the cross-check
// verdicts already applied; PreDropped lists facts the cross-check judged unsupported.
type finalItem struct {
	JobID, FileID, Path, Rel, Title, Kind, Hash string
	ChunkCount                                  int
	Prov                                        Provenance
	Facts                                       []FinalFact
	PreDropped                                  []DroppedFact
	// Verify lists the questionable facts without a verdict yet; set only for the verify step.
	Verify []VerifyFact
}

// extractedFile is a file in state extracted with everything the next step needs.
type extractedFile struct {
	finalItem
	verdicts map[string]Verdict
}

func (s *store) loadExtracted(tx *sql.Tx, fileID string) (extractedFile, error) {
	var f extractedFile
	var verify string
	err := tx.QueryRow(`SELECT f.job_id, f.id, f.path, f.rel_path, f.title, f.kind, f.content_hash, f.chunk_count, f.verify_json,
		j.origin, COALESCE(j.source_tag, ''), j.scope, COALESCE(j.project, ''), COALESCE(j.session_id, '')
		FROM import_files f JOIN import_jobs j ON j.id = f.job_id WHERE f.id = ?`, fileID).
		Scan(&f.JobID, &f.FileID, &f.Path, &f.Rel, &f.Title, &f.Kind, &f.Hash, &f.ChunkCount, &verify,
			&f.Prov.Origin, &f.Prov.SourceTag, &f.Prov.Scope, &f.Prov.Project, &f.Prov.Session)
	if err != nil {
		return f, err
	}
	if json.Unmarshal([]byte(verify), &f.verdicts) != nil || f.verdicts == nil {
		f.verdicts = map[string]Verdict{}
	}
	rows, err := tx.Query(`SELECT idx, text, facts FROM import_chunks WHERE file_id = ? ORDER BY idx`, fileID)
	if err != nil {
		return f, err
	}
	defer rows.Close()
	for rows.Next() {
		var idx int
		var text, raw string
		if err := rows.Scan(&idx, &text, &raw); err != nil {
			return f, err
		}
		var facts []Fact
		if err := json.Unmarshal([]byte(raw), &facts); err != nil {
			return f, fmt.Errorf("import: chunk facts: %w", err)
		}
		for n, fact := range facts {
			ff := FinalFact{ID: fmt.Sprintf("%d.%d", idx+1, n+1), Chunk: idx + 1, Fact: fact}
			if Questionable(text, fact) {
				if _, judged := f.verdicts[ff.ID]; !judged {
					f.Verify = append(f.Verify, VerifyFact{ID: ff.ID, Fact: fact.Fact, Evidence: fact.Evidence, Section: fact.Section, Unresolved: fact.Unresolved})
				}
			}
			f.Facts = append(f.Facts, ff)
		}
	}
	return f, rows.Err()
}

// applyVerdicts folds the cross-check verdicts into the facts: confirmed and rewritten facts are
// resolved, unsupported ones leave for the dropped list, ambiguous ones stay unresolved.
func (f *extractedFile) applyVerdicts() {
	kept := f.Facts[:0:0]
	for _, ff := range f.Facts {
		v, judged := f.verdicts[ff.ID]
		switch {
		case !judged:
		case v.Verdict == VerdictConfirmed:
			ff.Unresolved = ""
		case v.Verdict == VerdictRewritten:
			if v.Fact != "" {
				ff.Fact.Fact = v.Fact
			}
			if v.Evidence != "" {
				ff.Evidence = v.Evidence
			}
			ff.Unresolved = ""
		case v.Verdict == VerdictUnsupported:
			f.PreDropped = append(f.PreDropped, DroppedFact{Fact: ff.Fact.Fact, Why: "Not supported by the source: " + v.Why})
			continue
		}
		kept = append(kept, ff)
	}
	f.Facts = kept
}

// extractedIDs lists the extracted files of running jobs, in work order.
func extractedIDs(tx *sql.Tx) ([]string, error) {
	rows, err := tx.Query(`SELECT f.id FROM import_files f JOIN import_jobs j ON j.id = f.job_id
		WHERE f.state = 'extracted' AND j.state = 'running' ORDER BY j.created_at, f.rel_path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// claimVerify reserves the next extracted file that still has questionable facts without a verdict.
func (s *store) claimVerify() (finalItem, bool, error) {
	var out finalItem
	found := false
	err := s.tx(func(tx *sql.Tx) error {
		ids, err := extractedIDs(tx)
		if err != nil {
			return err
		}
		for _, id := range ids {
			f, err := s.loadExtracted(tx, id)
			if err != nil {
				return err
			}
			if f.Kind == KindMemdoc || len(f.Verify) == 0 {
				continue
			}
			if _, err := tx.Exec(`UPDATE import_files SET state = 'verifying', updated_at = ? WHERE id = ?`, s.now(), id); err != nil {
				return err
			}
			out, found = f.finalItem, true
			return nil
		}
		return nil
	})
	return out, found, err
}

// claimFinalize reserves the next extracted file with nothing left to cross-check, verdicts applied.
func (s *store) claimFinalize() (finalItem, bool, error) {
	var out finalItem
	found := false
	err := s.tx(func(tx *sql.Tx) error {
		ids, err := extractedIDs(tx)
		if err != nil {
			return err
		}
		for _, id := range ids {
			f, err := s.loadExtracted(tx, id)
			if err != nil {
				return err
			}
			if len(f.Verify) > 0 && f.Kind != KindMemdoc {
				continue
			}
			f.applyVerdicts()
			if _, err := tx.Exec(`UPDATE import_files SET state = 'finalizing', finalize_attempts = finalize_attempts + 1, updated_at = ? WHERE id = ?`,
				s.now(), id); err != nil {
				return err
			}
			out, found = f.finalItem, true
			return nil
		}
		return nil
	})
	return out, found, err
}

// saveVerdicts records a batch of cross-check verdicts and counts them.
func (s *store) saveVerdicts(it finalItem, batch map[string]Verdict, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		var raw string
		if err := tx.QueryRow(`SELECT verify_json FROM import_files WHERE id = ?`, it.FileID).Scan(&raw); err != nil {
			return err
		}
		all := map[string]Verdict{}
		_ = json.Unmarshal([]byte(raw), &all)
		for id, v := range batch {
			all[id] = v
		}
		out, _ := json.Marshal(all)
		_, err := tx.Exec(`UPDATE import_files SET verify_json = ?, verified = ?, updated_at = ? WHERE id = ? AND state = 'verifying'`,
			string(out), len(all), s.now(), it.FileID)
		return err
	})
}

// endVerify moves a verifying file back to extracted, so the next claim sees its verdicts.
func (s *store) endVerify(it finalItem, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE import_files SET state = 'extracted', updated_at = ? WHERE id = ? AND state = 'verifying'`, s.now(), it.FileID)
		return err
	})
}

func (s *store) failVerify(it finalItem, msg string, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE import_files SET state = 'failed', reason = ?, updated_at = ? WHERE id = ? AND state = 'verifying'`,
			"Cross-check: "+msg, s.now(), it.FileID)
		return err
	})
}

// finishFile records a finalized file: counts from memory_events (the agent's own tally is never
// trusted), the agent's unresolved and dropped lists plus what the cross-check dropped, and drops
// the chunk rows. A memdoc passes its own result.
func (s *store) finishFile(it finalItem, out FinalizeOutput, u usage) error {
	unresolved, _ := json.Marshal(nonNil(out.Unresolved))
	dropped, _ := json.Marshal(nonNil(append(slices.Clone(it.PreDropped), out.Dropped...)))
	var prov any
	if out.Prov != nil {
		raw, _ := json.Marshal(out.Prov)
		prov = string(raw)
	}
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		counts := map[string]int{}
		rows, err := tx.Query(`SELECT action, count(*) FROM memory_events WHERE source = 'import' AND source_ref = ? GROUP BY action`, it.FileID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var action string
			var n int
			if err := rows.Scan(&action, &n); err != nil {
				_ = rows.Close()
				return err
			}
			counts[action] = n
		}
		_ = rows.Close()
		group := out.GroupID
		if group == "" {
			if err := tx.QueryRow(`SELECT COALESCE((SELECT id FROM memory_groups WHERE kind = 'document' AND key = ?), '')`, it.Path).Scan(&group); err != nil {
				return err
			}
		}
		res, err := tx.Exec(`UPDATE import_files SET state = 'done', reason = '', added = ?, updated = ?, noop = ?,
			unresolved = ?, dropped = ?, orphaned = ?, group_id = ?, prov_json = COALESCE(?, prov_json), updated_at = ?
			WHERE id = ? AND state = 'finalizing'`,
			counts["add"], counts["update"], counts["noop"], string(unresolved), string(dropped), out.Orphaned, group, prov, s.now(), it.FileID)
		if err != nil || rowsAffected(res) == 0 {
			return err
		}
		_, err = tx.Exec(`DELETE FROM import_chunks WHERE file_id = ?`, it.FileID)
		return err
	})
}

// storeDoc records a materialised memdoc: no chunks, straight to extracted.
func (s *store) storeDoc(fileID, hash, title string) error {
	_, err := s.db.Exec(`UPDATE import_files SET kind = 'memdoc', content_hash = ?, title = ?, chunk_count = 0, est_tokens = 0,
		state = 'extracted', updated_at = ? WHERE id = ? AND state = 'extracting'`, hash, title, s.now(), fileID)
	return err
}

// factIDs lists the fact ids a file's events touched, oldest first.
func (s *store) factIDs(fileID string, limit int) ([]string, error) {
	rows, err := s.db.Query(`SELECT lineage_id FROM memory_events WHERE source = 'import' AND source_ref = ?
		GROUP BY lineage_id ORDER BY min(seq) LIMIT ?`, fileID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

func (s *store) failFinalize(it finalItem, msg string, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE import_files SET state = 'failed', reason = ?, updated_at = ? WHERE id = ? AND state = 'finalizing'`,
			msg, s.now(), it.FileID)
		return err
	})
}

func (s *store) releaseFinalize(it finalItem, u usage) error {
	return s.tx(func(tx *sql.Tx) error {
		if err := addUsage(tx, it.JobID, it.FileID, u); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE import_files SET state = 'extracted', updated_at = ? WHERE id = ? AND state = 'finalizing'`, s.now(), it.FileID)
		return err
	})
}

// finishJobIfIdle marks a running job done once every file is terminal. It reports whether it did.
func (s *store) finishJobIfIdle(jobID string) (bool, error) {
	var done bool
	err := s.tx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE import_jobs SET state = 'done', finished_at = ? WHERE id = ? AND state = 'running'
			AND NOT EXISTS (SELECT 1 FROM import_files WHERE job_id = ? AND state IN ('pending', 'extracting', 'extracted', 'verifying', 'finalizing'))`,
			s.now(), jobID, jobID)
		done = err == nil && rowsAffected(res) > 0
		return err
	})
	return done, err
}

// doneHash reports the date a done file with this content hash was imported under the same
// provenance as the job: the same file ingested into another scope is a different store.
func (s *store) doneHash(hash, jobID string) (string, bool, error) {
	var at string
	err := s.db.QueryRow(`SELECT f.updated_at FROM import_files f JOIN import_jobs j ON j.id = f.job_id
		JOIN import_jobs cur ON cur.id = ?
		WHERE f.state = 'done' AND f.content_hash = ? AND j.origin = cur.origin AND j.source_tag IS cur.source_tag
			AND j.scope = cur.scope AND j.project IS cur.project
		ORDER BY f.updated_at DESC LIMIT 1`, jobID, hash).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return at, err == nil, err
}

const jobColumns = `j.id, j.roots, j.base, j.state, j.reason, j.truncated, j.ignored_count, j.est_tokens, j.calls, j.cost_usd,
	j.created_at, j.started_at, j.finished_at,
	(SELECT count(*) FROM import_files f WHERE f.job_id = j.id AND f.state != 'skipped'),
	(SELECT count(*) FROM import_files f WHERE f.job_id = j.id AND f.state IN ('done', 'failed', 'cancelled')),
	(SELECT COALESCE(sum(f.chunk_count), 0) FROM import_files f WHERE f.job_id = j.id AND f.state != 'skipped'),
	(SELECT COALESCE(sum(CASE WHEN f.state = 'done' THEN f.chunk_count
		ELSE (SELECT count(*) FROM import_chunks c WHERE c.file_id = f.id AND c.state = 'done') END), 0)
		FROM import_files f WHERE f.job_id = j.id AND f.state != 'skipped'),
	(SELECT COALESCE(sum(f.added), 0) FROM import_files f WHERE f.job_id = j.id),
	(SELECT COALESCE(sum(f.updated), 0) FROM import_files f WHERE f.job_id = j.id),
	(SELECT COALESCE(sum(f.noop), 0) FROM import_files f WHERE f.job_id = j.id),
	(SELECT COALESCE(sum(json_array_length(f.unresolved)), 0) FROM import_files f WHERE f.job_id = j.id),
	(SELECT count(*) FROM import_files f WHERE f.job_id = j.id AND f.state = 'failed'),
	(SELECT count(*) FROM import_files f WHERE f.job_id = j.id AND f.state = 'skipped'),
	(SELECT COALESCE(sum(json_array_length(f.dropped)), 0) FROM import_files f WHERE f.job_id = j.id),
	j.channel, j.origin, j.source_tag, j.scope, j.project, j.session_id, j.groups_json, j.auto_start, j.write_doc`

func scanJobRow(r interface{ Scan(...any) error }) (Job, error) {
	var j Job
	var roots, groups string
	if err := r.Scan(&j.ID, &roots, &j.Base, &j.State, &j.Reason, &j.Truncated, &j.IgnoredCount, &j.Estimate.Tokens, &j.Calls, &j.CostUSD,
		&j.CreatedAt, &j.StartedAt, &j.FinishedAt,
		&j.Progress.FilesTotal, &j.Progress.FilesDone, &j.Progress.ChunksTotal, &j.Progress.ChunksDone,
		&j.Totals.Added, &j.Totals.Updated, &j.Totals.Noop, &j.Totals.Unresolved, &j.Totals.FailedFiles, &j.Totals.SkippedFiles,
		&j.Totals.Dropped, &j.Channel, &j.Origin, &j.SourceTag, &j.Scope, &j.Project, &j.SessionID, &groups, &j.AutoStart, &j.WriteDoc); err != nil {
		return Job{}, err
	}
	if err := json.Unmarshal([]byte(groups), &j.Groups); err != nil || j.Groups == nil {
		j.Groups = []memory.GroupRef{}
	}
	if err := json.Unmarshal([]byte(roots), &j.Roots); err != nil || j.Roots == nil {
		j.Roots = []string{}
	}
	return j, nil
}

func (s *store) fillEstimate(j *Job) error {
	rows, err := s.db.Query(`SELECT chunk_count FROM import_files WHERE job_id = ? AND state != 'skipped'`, j.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var counts []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			return err
		}
		counts = append(counts, n)
	}
	j.Estimate = EstimateWork(counts, j.Estimate.Tokens)
	return rows.Err()
}

// listJobs returns every job not dismissed, newest first.
func (s *store) listJobs() ([]Job, error) {
	rows, err := s.db.Query(`SELECT ` + jobColumns + ` FROM import_jobs j WHERE j.dismissed_at IS NULL ORDER BY j.created_at DESC, j.id`)
	if err != nil {
		return nil, err
	}
	jobs := []Job{}
	for rows.Next() {
		j, err := scanJobRow(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	for i := range jobs {
		if err := s.fillEstimate(&jobs[i]); err != nil {
			return nil, err
		}
	}
	return jobs, nil
}

func (s *store) jobDetail(id string) (JobDetail, error) {
	j, err := scanJobRow(s.db.QueryRow(`SELECT `+jobColumns+` FROM import_jobs j WHERE j.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return JobDetail{}, ErrNotFound
	}
	if err != nil {
		return JobDetail{}, err
	}
	if err := s.fillEstimate(&j); err != nil {
		return JobDetail{}, err
	}
	rows, err := s.db.Query(`SELECT f.id, f.rel_path, f.kind, f.size, f.state, f.reason, f.title, f.chunk_count,
		CASE WHEN f.state = 'done' THEN f.chunk_count
			ELSE (SELECT count(*) FROM import_chunks c WHERE c.file_id = f.id AND c.state = 'done') END,
		f.fact_count, f.added, f.updated, f.noop, f.unresolved, f.dropped, f.cost_usd,
		f.verified, f.orphaned, f.group_id, f.prov_json, f.doc_path, f.doc_error
		FROM import_files f WHERE f.job_id = ? ORDER BY f.rel_path`, id)
	if err != nil {
		return JobDetail{}, err
	}
	defer rows.Close()
	d := JobDetail{Job: j, Files: []File{}}
	for rows.Next() {
		var f File
		var unresolved, dropped, prov string
		if err := rows.Scan(&f.ID, &f.RelPath, &f.Kind, &f.Size, &f.State, &f.Reason, &f.Title, &f.ChunkCount, &f.ChunksDone,
			&f.FactCount, &f.Added, &f.Updated, &f.Noop, &unresolved, &dropped, &f.CostUSD,
			&f.Verified, &f.Orphaned, &f.GroupID, &prov, &f.DocPath, &f.DocError); err != nil {
			return JobDetail{}, err
		}
		if prov != "" {
			var p Provenance
			if json.Unmarshal([]byte(prov), &p) == nil {
				f.Prov = &p
			}
		}
		if json.Unmarshal([]byte(unresolved), &f.Unresolved) != nil || f.Unresolved == nil {
			f.Unresolved = []UnresolvedFact{}
		}
		if json.Unmarshal([]byte(dropped), &f.Dropped) != nil || f.Dropped == nil {
			f.Dropped = []DroppedFact{}
		}
		d.Files = append(d.Files, f)
	}
	return d, rows.Err()
}
