package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/scripts/internal/runledger"
)

const workDir = ".commentsweep"

// Status values of a manifest record. kept:<gate> and the outcome statuses are derived at report time.
const (
	stBelowMin     = "below-min"
	stOverMax      = "over-max"
	stDirective    = "directive"
	stLicense      = "license"
	stGenerated    = "generated"
	stExcluded     = "excluded-path"
	stNotWholeLine = "not-whole-line"
	stCRLF         = "crlf"
	stParseError   = "parse-error"
	stEligible     = "eligible"
)

// Comment is one manifest record: every comment found, any size.
type Comment struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	Line   int    `json:"line"`
	Lang   string `json:"lang"`
	Chars  int    `json:"chars"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
	First  string `json:"first"`
	Test   bool   `json:"test,omitempty"`
}

// Unit is one eligible comment sent to the rewrite path.
type Unit struct {
	ID       string `json:"id"`
	File     string `json:"file"`
	Lang     string `json:"lang"`
	Line     int    `json:"line"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Text     string `json:"text"`
	Context  string `json:"context"`
	TextSha  string `json:"textSha"`
	FileSha  string `json:"fileSha"`
	InputKey string `json:"inputKey"`
	Test     bool   `json:"test,omitempty"`
}

type Dropped struct {
	Text string `json:"text"`
	Why  string `json:"why"`
}

// Result is one finished call. Outcome is rewritten, unchanged, kept or error.
type Result struct {
	ID       string    `json:"id"`
	InputKey string    `json:"inputKey"`
	Outcome  string    `json:"outcome"`
	Gate     string    `json:"gate,omitempty"`
	Text     string    `json:"text,omitempty"`
	Reason   string    `json:"reason,omitempty"`
	Dropped  []Dropped `json:"dropped,omitempty"`
	CostUSD  float64   `json:"costUsd"`
	WallMs   int64     `json:"wallMs"`
	Error    string    `json:"error,omitempty"`
}

const (
	outRewritten = "rewritten"
	outUnchanged = "unchanged"
	outKept      = "kept"
	outError     = "error"
)

type Meta struct {
	Base      string    `json:"base"`
	MinChars  int       `json:"minChars"`
	MaxChars  int       `json:"maxChars"`
	CreatedAt time.Time `json:"createdAt"`
}

type Applied struct {
	Lang      string   `json:"lang"`
	File      string   `json:"file"`
	BeforeSha string   `json:"beforeSha"`
	AfterSha  string   `json:"afterSha"`
	Units     []string `json:"units"`
}

type Restored struct {
	ID   string `json:"id"`
	File string `json:"file"`
}

// RunLog is one `run` invocation, for wall-time accounting.
type RunLog struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
	Jobs  int       `json:"jobs"`
	Calls int       `json:"calls"`
}

func wpath(name string) string { return filepath.Join(workDir, name) }

func sha(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// readLines streams the JSON lines of a work file into fn; a missing file is empty and a torn line is skipped.
func readLines[T any](name string, fn func(T)) error {
	f, err := os.Open(wpath(name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 1<<20)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			var v T
			if json.Unmarshal(line, &v) == nil {
				fn(v)
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func loadAll[T any](name string) ([]T, error) {
	var out []T
	err := readLines(name, func(v T) { out = append(out, v) })
	return out, err
}

func writeAll[T any](name string, items []T) error {
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}
	tmp := wpath(name + ".tmp")
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, it := range items {
		if err := enc.Encode(it); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, wpath(name))
}

func appendWork(name string, v any) error { return runledger.AppendLine(wpath(name), v) }

func loadMeta() (Meta, error) {
	var m Meta
	raw, err := os.ReadFile(wpath("meta.json"))
	if err != nil {
		return m, err
	}
	return m, json.Unmarshal(raw, &m)
}

// loadResults is the last result line per inputKey.
func loadResults() (map[string]Result, error) {
	res := map[string]Result{}
	err := readLines("results.jsonl", func(r Result) {
		if r.InputKey != "" {
			res[r.InputKey] = r
		}
	})
	return res, err
}

func loadUnits() ([]Unit, error) { return loadAll[Unit]("units.jsonl") }

func unitsOfLang(units []Unit, lang string) []Unit {
	var out []Unit
	for _, u := range units {
		if lang == "" || u.Lang == lang {
			out = append(out, u)
		}
	}
	return out
}

func langOrder(l string) int {
	switch l {
	case "go":
		return 0
	case "ts":
		return 1
	}
	return 2
}

func sortUnits(us []Unit) {
	sort.SliceStable(us, func(i, j int) bool {
		a, b := us[i], us[j]
		if langOrder(a.Lang) != langOrder(b.Lang) {
			return langOrder(a.Lang) < langOrder(b.Lang)
		}
		if a.File != b.File {
			return a.File < b.File
		}
		return a.Start < b.Start
	})
}

func firstLine(text string) string {
	for _, l := range strings.Split(text, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			if r := []rune(t); len(r) > 110 {
				return string(r[:110]) + "..."
			}
			return t
		}
	}
	return ""
}
