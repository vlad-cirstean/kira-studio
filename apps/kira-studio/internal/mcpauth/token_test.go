package mcpauth

import (
	"path/filepath"
	"testing"
)

func TestMintVerifyRoundTrip(t *testing.T) {
	plain, rec, err := Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if !Verify(plain, rec) {
		t.Fatal("Verify(plain, rec) = false, want true")
	}
}

func TestVerifyRejectsWrongToken(t *testing.T) {
	_, rec, err := Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	other, _, err := Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if Verify(other, rec) {
		t.Fatal("Verify(other-plaintext, rec) = true, want false")
	}
	if Verify("not-even-base64!!", rec) {
		t.Fatal("Verify(garbage, rec) = true, want false")
	}
	if Verify("", rec) {
		t.Fatal("Verify(\"\", rec) = true, want false")
	}
}

func TestLoadOrMintMintsOnceThenLoads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "token.json")

	plain1, rec1, minted1, err := LoadOrMint(path)
	if err != nil {
		t.Fatalf("LoadOrMint (first): %v", err)
	}
	if !minted1 || plain1 == "" {
		t.Fatalf("first LoadOrMint: minted=%v plain=%q, want minted=true and a plaintext", minted1, plain1)
	}

	plain2, rec2, minted2, err := LoadOrMint(path)
	if err != nil {
		t.Fatalf("LoadOrMint (second): %v", err)
	}
	if minted2 || plain2 != "" {
		t.Fatalf("second LoadOrMint: minted=%v plain=%q, want minted=false and no plaintext", minted2, plain2)
	}
	if string(rec1.Hash) != string(rec2.Hash) || string(rec1.Salt) != string(rec2.Salt) {
		t.Fatal("second LoadOrMint returned a different record than the first mint persisted")
	}
	if !Verify(plain1, rec2) {
		t.Fatal("the originally-minted plaintext no longer verifies against the loaded record")
	}
}

func TestSlugIsStableAndTwelveHexChars(t *testing.T) {
	a := Slug("repo-a")
	b := Slug("repo-a")
	c := Slug("repo-b")
	if a != b {
		t.Fatalf("Slug is not stable: %q != %q", a, b)
	}
	if a == c {
		t.Fatal("Slug collided for two different ids")
	}
	if len(a) != 12 {
		t.Fatalf("Slug length = %d, want 12", len(a))
	}
}
