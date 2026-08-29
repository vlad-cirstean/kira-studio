package repos_test

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// testCipher is a real AES-256-GCM implementation of repos.Cipher (P52 §6's kira:v2: envelope
// shape), not a mock — secrets_test.go exercises the actual encrypt/decrypt round trip.
type testCipher struct {
	key                        [32]byte
	encryptCalls, decryptCalls int
}

const testCipherPrefix = "kira:v2:"

func newTestCipher(t *testing.T) *testCipher {
	t.Helper()
	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return &testCipher{key: key}
}

func (c *testCipher) gcm() (cipher.AEAD, error) {
	block, err := aes.NewCipher(c.key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func (c *testCipher) Encrypt(plain string) (string, error) {
	c.encryptCalls++
	gcm, err := c.gcm()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return testCipherPrefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (c *testCipher) Decrypt(stored string) (string, error) {
	c.decryptCalls++
	if !strings.HasPrefix(stored, testCipherPrefix) {
		return "", fmt.Errorf("testCipher: not enveloped")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, testCipherPrefix))
	if err != nil {
		return "", err
	}
	gcm, err := c.gcm()
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("testCipher: ciphertext too short")
	}
	nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// alwaysFailCipher's Decrypt always errors — used to assert Get propagates a cipher error
// instead of swallowing it.
type alwaysFailCipher struct{}

func (alwaysFailCipher) Encrypt(plain string) (string, error) { return "stored:" + plain, nil }
func (alwaysFailCipher) Decrypt(string) (string, error)       { return "", fmt.Errorf("cipher unavailable") }

func newSecretsRepo(t *testing.T, c repos.Cipher) (*repos.SecretsRepo, *sql.DB) {
	db := newRepos(t).DB
	return repos.NewSecrets(db, c), db
}

func TestSecretsSetGetRoundTrip(t *testing.T) {
	r, db := newSecretsRepo(t, newTestCipher(t))
	seedConnection(t, db, "c1")

	secret := "hunter2"
	if err := r.Set("c1", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err := r.Get("c1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil || *got != secret {
		t.Errorf("Get() = %v, want %q", got, secret)
	}
}

func TestSecretsSetNilClears(t *testing.T) {
	r, db := newSecretsRepo(t, newTestCipher(t))
	seedConnection(t, db, "c1")

	secret := "hunter2"
	if err := r.Set("c1", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := r.Set("c1", nil); err != nil {
		t.Fatalf("Set(nil): %v", err)
	}
	got, err := r.Get("c1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Errorf("Get() after Set(nil) = %v, want nil", got)
	}
}

func TestSecretsGetOnNullPasswordReturnsNil(t *testing.T) {
	r, db := newSecretsRepo(t, newTestCipher(t))
	seedConnection(t, db, "c1")

	got, err := r.Get("c1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Errorf("Get() on a fresh connection = %v, want nil", got)
	}
}

func TestSecretsCopyIsByteForByteAndTouchesNoCipher(t *testing.T) {
	c := newTestCipher(t)
	r, db := newSecretsRepo(t, c)
	seedConnection(t, db, "from")
	seedConnection(t, db, "to")

	secret := "hunter2"
	if err := r.Set("from", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}

	var storedBefore string
	if err := db.QueryRow(`SELECT password FROM connections WHERE id = 'from'`).Scan(&storedBefore); err != nil {
		t.Fatalf("read stored: %v", err)
	}

	encBefore, decBefore := c.encryptCalls, c.decryptCalls
	if err := r.Copy("from", "to"); err != nil {
		t.Fatalf("Copy: %v", err)
	}
	if c.encryptCalls != encBefore || c.decryptCalls != decBefore {
		t.Errorf("Copy() called the cipher: encrypt %d->%d, decrypt %d->%d, want no change",
			encBefore, c.encryptCalls, decBefore, c.decryptCalls)
	}

	var storedAfter string
	if err := db.QueryRow(`SELECT password FROM connections WHERE id = 'to'`).Scan(&storedAfter); err != nil {
		t.Fatalf("read copied: %v", err)
	}
	if storedAfter != storedBefore {
		t.Errorf("Copy() stored value = %q, want byte-for-byte %q", storedAfter, storedBefore)
	}
}

func TestSecretsDeleteNullsColumn(t *testing.T) {
	r, db := newSecretsRepo(t, newTestCipher(t))
	seedConnection(t, db, "c1")

	secret := "hunter2"
	if err := r.Set("c1", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := r.Delete("c1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	var stored sql.NullString
	if err := db.QueryRow(`SELECT password FROM connections WHERE id = 'c1'`).Scan(&stored); err != nil {
		t.Fatalf("read: %v", err)
	}
	if stored.Valid {
		t.Errorf("password column after Delete = %q, want NULL", stored.String)
	}
}

func TestSecretsGetPropagatesDecryptError(t *testing.T) {
	r, db := newSecretsRepo(t, alwaysFailCipher{})
	seedConnection(t, db, "c1")

	secret := "hunter2"
	if err := r.Set("c1", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := r.Get("c1"); err == nil {
		t.Error("Get() with a failing cipher = nil error, want the cipher's error to propagate")
	}
}
