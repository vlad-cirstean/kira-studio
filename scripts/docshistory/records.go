package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
)

const (
	stateOK       = "ok"
	stateFallback = "fallback"
)

// Record is the last known result of one unit.
type Record struct {
	Slug         string   `json:"slug"`
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Status       string   `json:"status"`
	InputSha256  string   `json:"inputSha256"`
	InChars      int      `json:"inChars"`
	State        string   `json:"state"`
	Reason       string   `json:"reason,omitempty"`
	Lines        []string `json:"lines"`
	Unresolved   int      `json:"unresolved"`
	CostUSD      float64  `json:"costUsd"`
	WallMs       int64    `json:"wallMs"`
	SourceCommit string   `json:"sourceCommit"`
}

// loadRecords returns the last record per slug; a torn trailing line is ignored.
func loadRecords(path string) (map[string]Record, error) {
	recs := map[string]Record{}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return recs, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		var r Record
		if json.Unmarshal(sc.Bytes(), &r) != nil || r.Slug == "" {
			continue
		}
		recs[r.Slug] = r
	}
	return recs, sc.Err()
}

func appendLine(path string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(raw, '\n'))
	return err
}
