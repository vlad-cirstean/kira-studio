package postmanstore

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/cions/leveldb-cli/indexeddb"
	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// openReadOnlyCopy copies the LevelDB files that matter (CURRENT, every MANIFEST-*, every sstable
// and every write-ahead log) out of dir into a fresh temp directory and opens the copy read-only,
// with Chromium's own idb_cmp1 comparer — never dir itself (P2 plan §2: goleveldb's flock does not
// conflict with the fcntl lock a running Postman holds, so opening in place risks a torn read of a
// database mid-compaction with no warning). Returns the opened DB and a cleanup func that removes
// the temp copy; the caller must call cleanup once done.
func openReadOnlyCopy(dir string) (*leveldb.DB, func(), error) {
	if running, err := postmanRunning(); err == nil && running {
		return nil, nil, refuse(ReasonStoreInUse,
			"Postman is running and may be writing to its own data. Quit Postman and try again.")
	}

	tmp, err := os.MkdirTemp("", "kira-postman-store-*")
	if err != nil {
		return nil, nil, fmt.Errorf("postmanstore: creating a scratch copy: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tmp) }

	if err := copyLevelDBFiles(dir, tmp); err != nil {
		cleanup()
		return nil, nil, refuse(ReasonStoreUnreadable, fmt.Sprintf(
			"could not read Postman's local data at %s: %s", dir, err))
	}

	db, err := leveldb.OpenFile(tmp, &opt.Options{
		ReadOnly:       true,
		ErrorIfMissing: true,
		Comparer:       indexeddb.Comparer,
	})
	if err != nil {
		// One retry: a write mid-copy (Postman launched between the process check above and the
		// copy) can leave the copy internally inconsistent; a fresh copy usually clears it.
		cleanup()
		tmp, mkErr := os.MkdirTemp("", "kira-postman-store-*")
		if mkErr != nil {
			return nil, nil, refuse(ReasonStoreUnreadable, err.Error())
		}
		cleanup = func() { _ = os.RemoveAll(tmp) }
		if copyErr := copyLevelDBFiles(dir, tmp); copyErr != nil {
			cleanup()
			return nil, nil, refuse(ReasonStoreUnreadable, copyErr.Error())
		}
		db, err = leveldb.OpenFile(tmp, &opt.Options{
			ReadOnly:       true,
			ErrorIfMissing: true,
			Comparer:       indexeddb.Comparer,
		})
		if err != nil {
			cleanup()
			return nil, nil, refuse(ReasonStoreUnreadable,
				fmt.Sprintf("Postman's local data at %s could not be read: %s", dir, err))
		}
	}

	return db, func() {
		_ = db.Close()
		cleanup()
	}, nil
}

// copyLevelDBFiles copies only what a LevelDB reader needs — CURRENT, MANIFEST-*, *.ldb/*.sst
// (sstables) and *.log (the write-ahead journal; recent writes live only there until compaction).
// LOCK and LOG/LOG.old are skipped on purpose: LOCK is meaningless once copied (a copy is never
// locked by the original process) and LOG is Chromium's own human-readable operations log, not
// data.
func copyLevelDBFiles(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	found := false
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !wantLevelDBFile(name) {
			continue
		}
		if err := copyFile(filepath.Join(src, name), filepath.Join(dst, name)); err != nil {
			return err
		}
		found = true
	}
	if !found {
		return fmt.Errorf("no LevelDB files found in %s", src)
	}
	return nil
}

func wantLevelDBFile(name string) bool {
	if name == "CURRENT" {
		return true
	}
	if strings.HasPrefix(name, "MANIFEST-") {
		return true
	}
	ext := filepath.Ext(name)
	return ext == ".ldb" || ext == ".sst" || ext == ".log"
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
