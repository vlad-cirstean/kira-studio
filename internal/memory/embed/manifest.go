package embed

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const manifestName = "installed.json"

type manifest struct {
	Model string           `json:"model"`
	Files map[string]int64 `json:"files"`
}

// Installed reports whether dir holds a complete install of s: the manifest written last by
// Install, naming this model, with every file present at its pinned size. It does not rehash.
func Installed(dir string, s Spec) bool {
	b, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return false
	}
	var m manifest
	if json.Unmarshal(b, &m) != nil || m.Model != s.ID {
		return false
	}
	for _, f := range s.Files {
		st, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil || st.Size() != f.Size || m.Files[f.Name] != f.Size {
			return false
		}
	}
	return true
}

func writeManifest(dir string, s Spec) error {
	m := manifest{Model: s.ID, Files: map[string]int64{}}
	for _, f := range s.Files {
		m.Files[f.Name] = f.Size
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, manifestName+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return fmt.Errorf("embed: write manifest: %w", err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, manifestName)); err != nil {
		return fmt.Errorf("embed: write manifest: %w", err)
	}
	return nil
}
