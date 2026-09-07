// Command gen writes apps/kira-studio/internal/datagrip/testdata/passwordsafe/ — the credential-
// store half of P25's fixtures, which cannot be captured from a real DataGrip profile in this
// sandbox (no display, a commercial trial account) (P25 §4.3). Run with:
//
//	KIRA_DATAGRIP_FIXTURES=write go run ./apps/kira-studio/internal/datagrip/testdata/gen
//
// The env var gate mirrors internal/ipcfixture's KIRA_IPC_FIXTURES=write — a plain `go run` with
// no env var refuses, so the committed fixtures are never silently overwritten by an accidental
// invocation.
//
// The c.pwd side of this is a genuinely independent check (§4.3): this file's AES-CBC-PKCS7
// encryption under "Proxy Config Sec" is written from EncryptionSupport.kt's description with no
// code shared with mainkey.go's own decrypt — a bug in one is very unlikely to be masked by an
// identical bug in the other. The c.kdbx side is NOT independent: writing and reading it with the
// same gokeepasslib cannot prove compatibility with a file IntelliJ itself wrote (§4.3's own
// stated limitation — see §4.4.3's opt-in real-profile test for what would close that gap).
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tobischo/gokeepasslib/v3"
	w "github.com/tobischo/gokeepasslib/v3/wrappers"
)

// Fixed fixture identities. The c.pwd/pdb.pwd side uses a deterministic IV (below), so
// regenerating those reproduces the same bytes; the .kdbx side still varies run to run (KDBX's
// own header carries random salts gokeepasslib generates internally) even though its content is
// deterministic — a real difference in the fixture's own shape only ever shows up as a content
// change on decode, not as a stable byte diff.
const (
	fixtureMainKey     = "kira-p25-fixture-main-key-4f7c9a1e2b3d5f608192a3b4c5d6e7f809" // ASCII, like an auto-generated main key (F7)
	fixtureUUID        = "99999999-0000-0000-0000-000000000001"
	fixtureEmptyPWUUID = "99999999-0000-0000-0000-000000000002"
	fixtureUsername    = "alice"
	fixturePassword    = "s3cret-fixture-password"

	builtInKey = "Proxy Config Sec" // EncryptionSupport.kt's hardcoded 16-byte AES key (F7)
)

func main() {
	if os.Getenv("KIRA_DATAGRIP_FIXTURES") != "write" {
		fmt.Fprintln(os.Stderr, "gen: refusing to run without KIRA_DATAGRIP_FIXTURES=write")
		os.Exit(1)
	}
	outDir := "apps/kira-studio/internal/datagrip/testdata/passwordsafe"
	if _, err := os.Stat("testdata/passwordsafe"); err == nil {
		outDir = "testdata/passwordsafe" // running from inside internal/datagrip
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fail(err)
	}

	mainKey := []byte(fixtureMainKey)

	writeCPwd(filepath.Join(outDir, "c.pwd"), "BUILT_IN", encryptBuiltIn(mainKey))
	writeCPwd(filepath.Join(outDir, "c.pwd.crypt32"), "CRYPT_32", encryptBuiltIn(mainKey))
	writeCPwd(filepath.Join(outDir, "c.pwd.pgp"), "PGP_KEY", encryptBuiltIn(mainKey))
	writeTruncatedCPwd(filepath.Join(outDir, "c.pwd.truncated"))
	writeFile(filepath.Join(outDir, "pdb.pwd"), encryptBuiltIn(mainKey))

	writeKDBXHappy(filepath.Join(outDir, "c.kdbx"), mainKey)
	writeKDBXNoGroup(filepath.Join(outDir, "c.kdbx.no-group"), mainKey)

	fmt.Println("gen: wrote", outDir)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "gen:", err)
	os.Exit(1)
}

// encryptBuiltIn is EncryptionSupport.kt's AesEncryptionSupport, independently reimplemented from
// F7's description (see the package comment above): AES/CBC/PKCS5Padding under the hardcoded
// "Proxy Config Sec" key, over a 4-byte-big-endian-IV-length ‖ IV ‖ ciphertext envelope.
func encryptBuiltIn(plaintext []byte) []byte {
	block, err := aes.NewCipher([]byte(builtInKey))
	if err != nil {
		fail(err)
	}
	// A fixed IV, not crypto/rand: this is a checked-in test fixture, not a real secret, and a
	// deterministic IV means re-running the generator reproduces byte-identical output.
	ivHash := sha256.Sum256([]byte("kira-p25-fixture-iv"))
	iv := ivHash[:aes.BlockSize]
	padded := pkcs5Pad(plaintext, aes.BlockSize)
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext, padded)

	envelope := make([]byte, 4+len(iv)+len(ciphertext))
	binary.BigEndian.PutUint32(envelope[:4], uint32(len(iv)))
	copy(envelope[4:], iv)
	copy(envelope[4+len(iv):], ciphertext)
	return envelope
}

func pkcs5Pad(data []byte, blockSize int) []byte {
	padLen := blockSize - len(data)%blockSize
	padding := make([]byte, padLen)
	for i := range padding {
		padding[i] = byte(padLen)
	}
	return append(append([]byte{}, data...), padding...)
}

// writeCPwd writes mainKey.kt's three-line file (F7), folding the base64 value across indented
// continuation lines the way SnakeYAML wraps a long scalar — exercising mainkey.go's block-scalar
// parse path, not just the inline one.
func writeCPwd(path, encryption string, envelope []byte) {
	encoded := base64.StdEncoding.EncodeToString(envelope)
	var folded strings.Builder
	for i := 0; i < len(encoded); i += 76 {
		end := i + 76
		if end > len(encoded) {
			end = len(encoded)
		}
		folded.WriteString("  ")
		folded.WriteString(encoded[i:end])
		folded.WriteString("\n")
	}
	content := fmt.Sprintf("encryption: %s\nisAutoGenerated: true\nvalue: !!binary |-\n%s", encryption, folded.String())
	writeFile(path, []byte(content))
}

// writeTruncatedCPwd is case 15: a syntactically valid BUILT_IN file whose envelope is too short
// to carry a real 16-byte IV — must fail as "could not decrypt the main key", never as a bad
// padding coincidence succeeding.
func writeTruncatedCPwd(path string) {
	short := []byte{0, 0, 0, 16, 1, 2, 3} // claims a 16-byte IV but has only 3 bytes after the length
	content := fmt.Sprintf("encryption: BUILT_IN\nisAutoGenerated: true\nvalue: !!binary %s\n",
		base64.StdEncoding.EncodeToString(short))
	writeFile(path, []byte(content))
}

// writeKDBXHappy builds §4.3's c.kdbx: KDBX 3.1, one "IntelliJ Platform" group, an entry for the
// happy-path uuid (case 12) and one whose password is empty (case 19).
func writeKDBXHappy(path string, mainKey []byte) {
	group := gokeepasslib.NewGroup()
	group.Name = "IntelliJ Platform"

	entry := gokeepasslib.NewEntry()
	entry.Values = append(entry.Values,
		mkValue("Title", serviceName(fixtureUUID)),
		mkValue("UserName", fixtureUsername),
		mkProtectedValue("Password", fixturePassword),
	)
	group.Entries = append(group.Entries, entry)

	emptyEntry := gokeepasslib.NewEntry()
	emptyEntry.Values = append(emptyEntry.Values,
		mkValue("Title", serviceName(fixtureEmptyPWUUID)),
		mkValue("UserName", "bob"),
		mkProtectedValue("Password", ""),
	)
	group.Entries = append(group.Entries, emptyEntry)

	writeKDBX(path, mainKey, group)
}

// writeKDBXNoGroup is case 17: a valid, decodable KDBX file with no "IntelliJ Platform" group at
// all — the D12 layout refusal, not a missed-entry "password not found".
func writeKDBXNoGroup(path string, mainKey []byte) {
	group := gokeepasslib.NewGroup()
	group.Name = "Some Other App"
	entry := gokeepasslib.NewEntry()
	entry.Values = append(entry.Values, mkValue("Title", "unrelated"), mkProtectedValue("Password", "x"))
	group.Entries = append(group.Entries, entry)
	writeKDBX(path, mainKey, group)
}

func writeKDBX(path string, mainKey []byte, rootGroup gokeepasslib.Group) {
	sum := sha256.Sum256(mainKey)
	db := gokeepasslib.NewDatabase(gokeepasslib.WithDatabaseKDBXVersion3())
	db.Credentials = &gokeepasslib.DBCredentials{Passphrase: sum[:]}
	db.Content.Root.Groups = []gokeepasslib.Group{rootGroup}

	if err := db.LockProtectedEntries(); err != nil {
		fail(err)
	}
	f, err := os.Create(path)
	if err != nil {
		fail(err)
	}
	defer f.Close()
	if err := gokeepasslib.NewEncoder(f).Encode(db); err != nil {
		fail(err)
	}
}

func mkValue(key, value string) gokeepasslib.ValueData {
	return gokeepasslib.ValueData{Key: key, Value: gokeepasslib.V{Content: value}}
}

func mkProtectedValue(key, value string) gokeepasslib.ValueData {
	return gokeepasslib.ValueData{Key: key, Value: gokeepasslib.V{Content: value, Protected: w.NewBoolWrapper(true)}}
}

// serviceName duplicates F4's generateServiceName("DB", uuid) — kept independent of the datagrip
// package's own copy on purpose, the same way the encryption above is.
func serviceName(uuid string) string {
	return fmt.Sprintf("IntelliJ Platform DB — %s", uuid)
}

func writeFile(path string, data []byte) {
	if err := os.WriteFile(path, data, 0o644); err != nil {
		fail(err)
	}
}
