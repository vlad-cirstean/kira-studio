package gitsock

import "testing"

// D6's crypto bar: mint/verify round-trips, a wrong salt fails, and a revoked/missing row's check
// never panics (exercised through verifyClientToken in handshake_test.go's table; this file
// covers mint/verifyToken directly).
func TestToken_MintThenVerify_Succeeds(t *testing.T) {
	t.Parallel()
	plain, hash, salt, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if !verifyToken(plain, hash, salt) {
		t.Fatal("verify failed for a freshly minted token")
	}
}

func TestToken_VerifyAgainstDifferentSalt_Fails(t *testing.T) {
	t.Parallel()
	plain, hash, _, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	_, _, otherSalt, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if verifyToken(plain, hash, otherSalt) {
		t.Fatal("verify succeeded against the wrong salt")
	}
}

func TestToken_VerifyWrongToken_Fails(t *testing.T) {
	t.Parallel()
	_, hash, salt, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	other, _, _, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if verifyToken(other, hash, salt) {
		t.Fatal("verify succeeded for an unrelated token")
	}
}

func TestToken_VerifyMalformedPresented_DoesNotPanic(t *testing.T) {
	t.Parallel()
	_, hash, salt, err := mintToken()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if verifyToken("not-base64url!!", hash, salt) {
		t.Fatal("verify succeeded for an undecodable token")
	}
}

func TestToken_DummyComparison_NeverPanics(t *testing.T) {
	t.Parallel()
	// The shape verifyClientToken uses for a missing client id (D6): compare against the fixed
	// dummy pair so a miss costs the same as a real mismatch.
	if verifyToken("anything", dummyHash, dummySalt) {
		t.Fatal("verify unexpectedly succeeded against the dummy hash")
	}
}
