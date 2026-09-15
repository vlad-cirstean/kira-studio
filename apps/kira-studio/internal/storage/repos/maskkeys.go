package repos

import (
	"crypto/rand"
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
)

// maskKeyBytes is the correlation key's own size (plan §2.5: "32 random bytes, per connection").
const maskKeyBytes = 32

// MaskKeysRepo is the only file in this tree that reads or writes
// connections.mask_correlation_key — SecretsRepo's own "only file that touches this column"
// discipline (secrets.go:21-23), applied to M5's correlation key. It is deliberately not part of
// ConnectionFields (model/connection.go's own D9), so a key can never reach the renderer, the
// connection URI, or the Copy URI menu item.
type MaskKeysRepo struct {
	db     *sql.DB
	cipher Cipher
}

// NewMaskKeys is separate from repos.New, the same reason NewSecrets is (D5): it needs a Cipher
// that does not exist inside that constructor's aggregate.
func NewMaskKeys(db *sql.DB, cipher Cipher) *MaskKeysRepo {
	return &MaskKeysRepo{db: db, cipher: cipher}
}

// Get returns the connection's own key, or nil when none has been minted yet ('' stored). Never
// mints — EnsureKey is the only writer.
func (r *MaskKeysRepo) Get(connectionID string) ([]byte, error) {
	var stored string
	if err := r.db.QueryRow(`SELECT mask_correlation_key FROM connections WHERE id = ?`, connectionID).Scan(&stored); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("repos/maskkeys: get %s: %w", connectionID, err)
	}
	if stored == "" {
		return nil, nil
	}
	plain, err := r.cipher.Decrypt(secrets.ScopeMaskKey, stored)
	if err != nil {
		return nil, fmt.Errorf("repos/maskkeys: decrypt %s: %w", connectionID, err)
	}
	return []byte(plain), nil
}

// EnsureKey returns the connection's own key, minting and persisting a fresh 32-byte one on first
// call (plan §2.5's own "lazy creation... the first time a connection renders a mask whose rule has
// correlate: true"). A connection with no correlating rule never calls this and so never gets one.
func (r *MaskKeysRepo) EnsureKey(connectionID string) ([]byte, error) {
	existing, err := r.Get(connectionID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	key := make([]byte, maskKeyBytes)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("repos/maskkeys: generate key: %w", err)
	}
	if err := r.setKey(connectionID, key); err != nil {
		return nil, err
	}
	return key, nil
}

// Regenerate mints and persists a brand-new key unconditionally, discarding whatever key (if any)
// existed before — the Privacy tab's own explicit "Regenerate correlation key" action (§7.4),
// never automatic. Every masked correlation tag for this connection changes as a result.
func (r *MaskKeysRepo) Regenerate(connectionID string) error {
	key := make([]byte, maskKeyBytes)
	if _, err := rand.Read(key); err != nil {
		return fmt.Errorf("repos/maskkeys: generate key: %w", err)
	}
	return r.setKey(connectionID, key)
}

func (r *MaskKeysRepo) setKey(connectionID string, key []byte) error {
	encrypted, err := r.cipher.Encrypt(secrets.ScopeMaskKey, string(key))
	if err != nil {
		return fmt.Errorf("repos/maskkeys: encrypt %s: %w", connectionID, err)
	}
	if _, err := r.db.Exec(`UPDATE connections SET mask_correlation_key = ? WHERE id = ?`, encrypted, connectionID); err != nil {
		return fmt.Errorf("repos/maskkeys: set %s: %w", connectionID, err)
	}
	return nil
}
