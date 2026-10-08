package mobileweb

import (
	"crypto/x509"
	"net"
	"testing"
	"time"
)

func newTestCA(t *testing.T) *CA {
	t.Helper()
	ca, err := LoadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return ca
}

func issueParsed(t *testing.T, ca *CA, ips []net.IP, names []string) *x509.Certificate {
	t.Helper()
	leaf, _, err := ca.IssueLeaf(ips, names, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(leaf.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

func verifyOpts(ca *CA) x509.VerifyOptions {
	return x509.VerifyOptions{Roots: ca.Pool(), KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
}

func TestCA_NameConstraintsAreCritical(t *testing.T) {
	t.Parallel()
	ca := newTestCA(t)
	if !ca.cert.IsCA || !ca.cert.PermittedDNSDomainsCritical {
		t.Fatalf("CA must be a CA with critical name constraints: IsCA=%v critical=%v", ca.cert.IsCA, ca.cert.PermittedDNSDomainsCritical)
	}
	if len(ca.cert.PermittedIPRanges) != len(permittedIPRanges) {
		t.Fatalf("permitted IP ranges = %d, want %d", len(ca.cert.PermittedIPRanges), len(permittedIPRanges))
	}
}

func TestCA_LeafVerifiesForPrivateNamesOnly(t *testing.T) {
	t.Parallel()
	ca := newTestCA(t)
	lan := issueParsed(t, ca, []net.IP{net.ParseIP("192.168.1.20")}, []string{"mac.local"})
	if _, err := lan.Verify(verifyOpts(ca)); err != nil {
		t.Fatalf("private leaf must verify: %v", err)
	}
	if err := lan.VerifyHostname("192.168.1.20"); err != nil {
		t.Fatalf("leaf must cover its IP SAN: %v", err)
	}
	if err := lan.VerifyHostname("mac.local"); err != nil {
		t.Fatalf("leaf must cover its DNS SAN: %v", err)
	}
	public := issueParsed(t, ca, []net.IP{net.ParseIP("8.8.8.8")}, nil)
	if _, err := public.Verify(verifyOpts(ca)); err == nil {
		t.Fatal("leaf for a public IP must fail verification under the CA's name constraints")
	}
	foreign := issueParsed(t, ca, nil, []string{"example.com"})
	if _, err := foreign.Verify(verifyOpts(ca)); err == nil {
		t.Fatal("leaf for a non-.local name must fail verification under the CA's name constraints")
	}
}

func TestCA_LeafMeetsPlatformLimits(t *testing.T) {
	t.Parallel()
	ca := newTestCA(t)
	now := time.Now()
	leaf, notAfter, err := ca.IssueLeaf([]net.IP{net.ParseIP("10.0.0.5")}, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(leaf.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if got := cert.NotAfter.Sub(now); got > 397*24*time.Hour {
		t.Fatalf("leaf validity %v exceeds 397 days", got)
	}
	if d := notAfter.Sub(cert.NotAfter); d < -time.Second || d > time.Second {
		t.Fatalf("returned expiry %v differs from certificate %v", notAfter, cert.NotAfter)
	}
	if len(cert.ExtKeyUsage) != 1 || cert.ExtKeyUsage[0] != x509.ExtKeyUsageServerAuth {
		t.Fatalf("EKU = %v, want serverAuth only", cert.ExtKeyUsage)
	}
	if cert.PublicKeyAlgorithm != x509.ECDSA {
		t.Fatalf("key algorithm = %v, want ECDSA", cert.PublicKeyAlgorithm)
	}
}

func TestCA_ReloadKeepsIdentityAndResetChangesIt(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	first, err := LoadOrCreateCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	again, err := LoadOrCreateCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.Fingerprint() != again.Fingerprint() {
		t.Fatal("reloading must keep the CA, or every phone loses trust")
	}
	reset, err := ResetCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reset.Fingerprint() == first.Fingerprint() {
		t.Fatal("reset must mint a new CA")
	}
}
