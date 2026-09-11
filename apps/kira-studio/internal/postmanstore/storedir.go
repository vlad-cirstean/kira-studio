package postmanstore

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// storeSuffixes are the two IndexedDB origins Postman desktop has used for its local Scratch Pad
// (offline `file://` window) and signed-in (`https://desktop.postman.com`) collections respectively
// (P2 plan §3e/§3f) — a modern signed-in install populates the second; the first is checked too
// since the Scratch Pad code path still ships even though the product has sunset the feature.
var storeSuffixes = []string{
	"file__0.indexeddb.leveldb",
	"https_desktop.postman.com_0.indexeddb.leveldb",
}

// StoreCandidate is one discovered IndexedDB LevelDB directory.
type StoreCandidate struct {
	Dir string
	// ScratchPad is true for the file__0 origin, false for the signed-in one — Scan prefers a
	// populated signed-in store over an empty legacy one when both exist (P2 plan §3f).
	ScratchPad bool
}

// postmanUserDataDir is Electron's userData directory for Postman, per OS. Windows is out of
// scope, the same call internal/datagrip's jetBrainsConfigRoot already made and for the same
// reason: no Windows environment here to verify LOCK-file semantics against (P2 plan §9).
func postmanUserDataDir() (string, error) {
	if runtime.GOOS == "windows" {
		return "", nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "Postman"), nil
	}
	return filepath.Join(home, ".config", "Postman"), nil
}

// DiscoverStores enumerates every IndexedDB LevelDB directory Postman might have written under
// root and its per-partition subdirectories (root itself, plus root/Partitions/*), the way
// datagrip.DiscoverConfigDirs enumerates JetBrains product directories. A missing root is not an
// error (os.IsNotExist) — absence is a fact Scan renders as an empty result, not a refusal.
func DiscoverStores(root string) ([]StoreCandidate, error) {
	if root == "" {
		return nil, nil
	}

	var roots []string
	if _, err := os.Stat(root); err == nil {
		roots = append(roots, root)
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	partitionsRoot := filepath.Join(root, "Partitions")
	if entries, err := os.ReadDir(partitionsRoot); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				roots = append(roots, filepath.Join(partitionsRoot, e.Name()))
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	var candidates []StoreCandidate
	for _, r := range roots {
		for _, suffix := range storeSuffixes {
			dir := filepath.Join(r, "IndexedDB", suffix)
			if !looksLikeLevelDBDir(dir) {
				continue
			}
			candidates = append(candidates, StoreCandidate{
				Dir:        dir,
				ScratchPad: strings.HasPrefix(suffix, "file__"),
			})
		}
	}

	// Signed-in stores first — they're the likelier populated one (P2 plan §3f); stable otherwise.
	sort.SliceStable(candidates, func(i, j int) bool {
		return !candidates[i].ScratchPad && candidates[j].ScratchPad
	})
	return candidates, nil
}

// looksLikeLevelDBDir is DiscoverStores' own looksLikeIDEConfigDir analogue: a directory only
// counts as a candidate when it actually looks like a LevelDB environment, not merely a folder
// with the right name.
func looksLikeLevelDBDir(dir string) bool {
	if _, err := os.Stat(filepath.Join(dir, "CURRENT")); err != nil {
		return false
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "MANIFEST-") {
			return true
		}
	}
	return false
}
