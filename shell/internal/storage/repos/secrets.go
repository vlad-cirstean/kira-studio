package repos

import (
	"database/sql"
	"fmt"
)

// Cipher is implemented by internal/secrets (P55) — P52 §6's kira:v2: AES-256-GCM envelope. Note
// what is absent from this interface versus the TS SecretCipher: no isEnveloped (its only caller,
// upgradeLegacySecrets, is deleted, not ported — §6.4), and no status (the repo never reads it;
// the cipher enforces availability inside Encrypt/Decrypt and returns E_SECRET_STORE itself).
type Cipher interface {
	Encrypt(plain string) (string, error)
	Decrypt(stored string) (string, error)
}

// SecretsRepo is the only file in this tree that reads or writes connections.password (P1 D8,
// mirrored from secrets.ts's own header comment). It never inspects the stored value's envelope
// itself — that is entirely the Cipher's business.
type SecretsRepo struct {
	db     *sql.DB
	cipher Cipher
}

// NewSecrets is separate from repos.New (D5): SecretsRepo needs a Cipher that does not exist
// until P55, so it is not part of the aggregate every other repo is constructed through.
func NewSecrets(db *sql.DB, cipher Cipher) *SecretsRepo {
	return &SecretsRepo{db: db, cipher: cipher}
}

func (r *SecretsRepo) Get(connectionID string) (*string, error) {
	var stored sql.NullString
	if err := r.db.QueryRow(`SELECT password FROM connections WHERE id = ?`, connectionID).Scan(&stored); err != nil {
		return nil, fmt.Errorf("repos/secrets: get %s: %w", connectionID, err)
	}
	if !stored.Valid {
		return nil, nil
	}
	plain, err := r.cipher.Decrypt(stored.String)
	if err != nil {
		return nil, fmt.Errorf("repos/secrets: decrypt %s: %w", connectionID, err)
	}
	return &plain, nil
}

func (r *SecretsRepo) Set(connectionID string, secret *string) error {
	var stored *string
	if secret != nil {
		encrypted, err := r.cipher.Encrypt(*secret)
		if err != nil {
			return fmt.Errorf("repos/secrets: encrypt %s: %w", connectionID, err)
		}
		stored = &encrypted
	}
	if _, err := r.db.Exec(`UPDATE connections SET password = ? WHERE id = ?`, stored, connectionID); err != nil {
		return fmt.Errorf("repos/secrets: set %s: %w", connectionID, err)
	}
	return nil
}

// Copy copies the stored column value verbatim — no decrypt, no re-encrypt (P25 D11). It must
// never touch the cipher.
func (r *SecretsRepo) Copy(fromConnectionID, toConnectionID string) error {
	var stored sql.NullString
	if err := r.db.QueryRow(`SELECT password FROM connections WHERE id = ?`, fromConnectionID).Scan(&stored); err != nil {
		return fmt.Errorf("repos/secrets: copy read %s: %w", fromConnectionID, err)
	}
	if _, err := r.db.Exec(`UPDATE connections SET password = ? WHERE id = ?`, stored, toConnectionID); err != nil {
		return fmt.Errorf("repos/secrets: copy write %s: %w", toConnectionID, err)
	}
	return nil
}

func (r *SecretsRepo) Delete(connectionID string) error {
	if _, err := r.db.Exec(`UPDATE connections SET password = NULL WHERE id = ?`, connectionID); err != nil {
		return fmt.Errorf("repos/secrets: delete %s: %w", connectionID, err)
	}
	return nil
}
