package importer

import (
	"context"
	"database/sql"
	"errors"
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
		if !ok || doc.Group != w.GroupID || (len(problems) > 0 && doc.Version != 1) {
			return "", "exists and is not this file's kira-memory doc"
		}
	} else if !os.IsNotExist(err) {
		return "", "cannot read " + filepath.Base(target) + ": " + err.Error()
	}
	mems, err := r.ms.DocumentFacts(ctx, it.FileID)
	if err != nil {
		return "", boundedMessage(err)
	}
	in := DocInput{GroupID: w.GroupID, Title: w.Title, FileName: filepath.Base(it.Path), Rel: it.Rel, Prov: w.Prov, Updated: r.opts.Now().Format(time.DateOnly)}
	text, left, bad, err := RenderDoc(in, mems)
	if err != nil {
		if errors.Is(err, errNoDocFacts) {
			return "", "no stored fact to write"
		}
		return "", boundedMessage(err)
	}
	if err := renameio.WriteFile(target, []byte(text), 0o644); err != nil {
		return "", "cannot write " + filepath.Base(target) + ": " + err.Error()
	}
	switch {
	case left > 0 && bad > 0:
		return target, fmt.Sprintf("%d fact(s) with another provenance and %d with text the format rejects left out", left, bad)
	case left > 0:
		return target, fmt.Sprintf("%d fact(s) with another provenance left out", left)
	case bad > 0:
		return target, fmt.Sprintf("%d fact(s) with text the format rejects left out", bad)
	}
	return target, ""
}

// DocInput is what RenderDoc needs besides the facts: the group, the raw file title, the file name used
// when the title is unusable, the job-relative path (the doc's "from", empty when unknown or not
// header-safe), the job provenance and the header date (YYYY-MM-DD).
type DocInput struct {
	GroupID, Title, FileName, Rel string
	Prov                          Provenance
	Updated                       string
}

var errNoDocFacts = errors.New("no stored fact to write")

// RenderDoc renders the kira-memory doc of a file's stored facts. A fact whose reason is the source
// locator of its section takes that section as its heading and no reason line; any other reason is
// written in full under the running section. left counts facts with another provenance, bad facts
// whose text the format rejects; both are left out. Pure: the write-back and the eval harness share it.
func RenderDoc(in DocInput, mems []memory.Memory) (text string, left, bad int, err error) {
	doc := memfmt.Doc{Group: in.GroupID, Title: docTitle(in.Title, in.FileName), Updated: in.Updated, Provenance: memfmt.Provenance{
		Origin: in.Prov.Origin, Source: in.Prov.SourceTag, Scope: in.Prov.Scope, Project: in.Prov.Project}}
	if memfmt.HeaderSafe(in.Rel) {
		doc.From = in.Rel
	}
	if in.Prov.Origin != memory.OriginExternal {
		doc.Session = in.Prov.Session
	}
	running := ""
	for _, m := range mems {
		if !sameProvenance(m, in.Prov) {
			left++
			continue
		}
		fact := docText(m.Fact)
		if fact == "" || strings.HasPrefix(fact, "fact: ") || strings.HasPrefix(fact, "reason: ") || strings.HasPrefix(fact, "keywords: ") {
			bad++
			continue
		}
		f := memfmt.Fact{ID: m.LineageID, Fact: fact, Section: running}
		section, isLocator := "", false
		if doc.From != "" {
			section, isLocator = memfmt.ParseLocator(m.Reason, doc.From)
		}
		switch {
		case isLocator && section != "":
			running, f.Section = section, section
		case isLocator && running == "":
		default:
			if f.Reason = docText(m.Reason); f.Reason == "" {
				bad++
				continue
			}
		}
		doc.Facts = append(doc.Facts, f)
	}
	if len(doc.Facts) == 0 {
		return "", left, bad, errNoDocFacts
	}
	text, err = memfmt.FormatDoc(doc)
	return text, left, bad, err
}

// docTitle makes a file title YAML-safe for the doc header: the format rejects ": ", " #" and a
// leading indicator, which real titles ("P153: plan") contain.
func docTitle(title, fallback string) string {
	t := strings.NewReplacer(": ", " - ", " #", " ").Replace(strings.Join(strings.Fields(title), " "))
	t = strings.TrimLeft(t, "[{&*!|>'\"%@` ")
	if t == "" {
		return fallback
	}
	return t
}

// docText returns s, or s without Markdown markup when that makes it valid, or "" when it cannot be
// written (the fact is then counted as left out).
func docText(s string) string {
	if memfmt.CheckText(s) == "" {
		return s
	}
	if t := memfmt.StripMarkup(s); memfmt.CheckText(t) == "" {
		return t
	}
	return ""
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
