// Package postmanstore reads Postman desktop's own local collection storage — a Chromium
// IndexedDB database backed by LevelDB — with no export step, modelled on internal/datagrip's
// shape (locate → scan → typed preview → import). Byte-format decisions (key encoding, the Blink/
// V8 value envelope, the v1→v2.1 conversion) are recorded in
// docs/v1.4/plans/P2-postman-leveldb-import.md, not re-derived in comments here.
package postmanstore

// Reason is a closed set of whole-operation refusal codes (P2 plan §7) — never a bare error
// string, so the frontend can render a specific message per case rather than "something failed".
type Reason string

const (
	// ReasonStoreInUse means a running Postman process was detected (or a copy-then-open failed in
	// a way consistent with one) before the store could be safely copied.
	ReasonStoreInUse Reason = "store-in-use"
	// ReasonStoreFormatUnsupported means the directory exists but isn't a LevelDB directory this
	// package can open — most likely Chromium's newer SQLite-backed IndexedDB implementation.
	ReasonStoreFormatUnsupported Reason = "store-format-unsupported"
	// ReasonNoCollections means the LevelDB directory opened fine but contains no "postman-app"
	// database, or that database has no collections store — treated the same as "nothing found".
	ReasonNoCollections Reason = "no-collections"
	// ReasonStoreUnreadable means goleveldb itself refused the directory (manifest/comparer
	// mismatch, unknown compression, corrupt sstable) after a retry.
	ReasonStoreUnreadable Reason = "store-unreadable"
)

// RefusalError is a whole-operation failure — Scan/Import cannot proceed at all. A single record
// failing to decode is never this; it is counted and skipped (see Preview/Report).
type RefusalError struct {
	Reason  Reason
	Message string
}

func (e *RefusalError) Error() string { return e.Message }

func refuse(reason Reason, message string) error {
	return &RefusalError{Reason: reason, Message: message}
}
