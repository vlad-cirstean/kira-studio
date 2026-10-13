package importer

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/renameio/v2"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const docSuffix = ".memory.md"

// writeBack writes a finished file's facts beside it as a kira-memory doc when the job asked for it.
// A failure lands in the file's doc_error; the file stays done.
func (r *Runner) writeBack(ctx context.Context, it finalItem) {
	if it.Kind == KindMemdoc {
		return
	}
	info, ok, err := r.st.writeInfo(it.FileID)
	if err != nil {
		slog.Error("memory import: write-back lookup", "scope", "memory", "err", err)
		return
	}
	if !ok {
		return
	}
	path, msg := r.writeDocFile(ctx, it, info)
	if err := r.st.setDoc(it.FileID, path, msg); err != nil {
		slog.Error("memory import: write-back result", "scope", "memory", "err", err)
	}
}

type writeInfo struct {
	Prov    Provenance
	GroupID string
	Title   string
}

// writeInfo reads the write-back inputs of a done file whose job asked for a doc and stored facts.
func (s *store) writeInfo(fileID string) (writeInfo, bool, error) {
	var w writeInfo
	var wanted bool
	err := s.db.QueryRow(`SELECT j.write_doc, j.origin, COALESCE(j.source_tag, ''), j.scope, COALESCE(j.project, ''),
		COALESCE(j.session_id, ''), f.group_id, f.title FROM import_files f JOIN import_jobs j ON j.id = f.job_id
		WHERE f.id = ? AND f.state = 'done'`, fileID).
		Scan(&wanted, &w.Prov.Origin, &w.Prov.SourceTag, &w.Prov.Scope, &w.Prov.Project, &w.Prov.Session, &w.GroupID, &w.Title)
	if err == sql.ErrNoRows {
		return w, false, nil
	}
	return w, err == nil && wanted && w.GroupID != "", err
}

func (s *store) setDoc(fileID, path, msg string) error {
	_, err := s.db.Exec(`UPDATE import_files SET doc_path = ?, doc_error = ?, updated_at = ? WHERE id = ?`, path, msg, s.now(), fileID)
	return err
}

// writeDocFile returns the written path or the reason it was not written.
func (r *Runner) writeDocFile(ctx context.Context, it finalItem, w writeInfo) (path, msg string) {
	target := strings.TrimSuffix(it.Path, filepath.Ext(it.Path)) + docSuffix
	if existing, err := os.ReadFile(target); err == nil {
		doc, ok, problems := memfmt.ParseDoc(existing)
		if !ok || len(problems) > 0 || doc.Group != w.GroupID {
			return "", "exists and is not this file's kira-memory doc"
		}
	} else if !os.IsNotExist(err) {
		return "", "cannot read " + filepath.Base(target) + ": " + err.Error()
	}
	mems, err := r.ms.DocumentFacts(ctx, it.FileID)
	if err != nil {
		return "", boundedMessage(err)
	}
	doc := memfmt.Doc{Group: w.GroupID, Title: w.Title, Updated: r.opts.Now().Format(time.DateOnly), Provenance: memfmt.Provenance{
		Origin: w.Prov.Origin, Source: w.Prov.SourceTag, Scope: w.Prov.Scope, Project: w.Prov.Project}}
	if w.Prov.Origin != memory.OriginExternal {
		doc.Session = w.Prov.Session
	}
	left := 0
	for _, m := range mems {
		if !sameProvenance(m, w.Prov) {
			left++
			continue
		}
		doc.Facts = append(doc.Facts, memfmt.Fact{ID: m.LineageID, Fact: m.Fact, Reason: m.Reason, Keywords: m.Keywords})
	}
	if len(doc.Facts) == 0 {
		return "", "no stored fact to write"
	}
	text, err := memfmt.FormatDoc(doc)
	if err != nil {
		return "", boundedMessage(err)
	}
	if err := renameio.WriteFile(target, []byte(text), 0o644); err != nil {
		return "", "cannot write " + filepath.Base(target) + ": " + err.Error()
	}
	if left > 0 {
		return target, fmt.Sprintf("%d fact(s) with another provenance left out", left)
	}
	return target, ""
}

func sameProvenance(m memory.Memory, p Provenance) bool {
	tag, project := "", ""
	if m.SourceTag != nil {
		tag = *m.SourceTag
	}
	if m.Project != nil {
		project = *m.Project
	}
	return m.Origin == p.Origin && tag == p.SourceTag && m.Scope == p.Scope && project == p.Project
}
