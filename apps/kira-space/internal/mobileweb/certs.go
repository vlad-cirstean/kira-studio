// Package mobileweb serves a read-only mobile web app for the ADE agents module over the local
// network: an HTTPS listener (app + API + SSE) and a plain-HTTP setup listener (the CA
// certificate). It is a second transport over the same services the Wails bridge binds, so it sits
// at bridge level in the layering rules.
package mobileweb

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

const (
	caKeyFile  = "ca.key"
	caCertFile = "ca.crt"

	caValidity = 10 * 365 * 24 * time.Hour
	// iOS rejects a TLS server certificate valid for more than 825 days; 397 is the browser
	// baseline.
	leafValidity = 397 * 24 * time.Hour
	// clockSkew backdates NotBefore so a phone with a slow clock still accepts a fresh cert.
	clockSkew = time.Hour
)

// permittedIPRanges is the CA's name constraint: a phone that trusts this root can only be
// impersonated for private LAN, loopback and CGNAT (Tailscale) addresses, never a public host.
var permittedIPRanges = mustCIDRs("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "100.64.0.0/10")

func mustCIDRs(cidrs ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(err)
		}
		out = append(out, n)
	}
	return out
}

// CA is Kira Space's own local certificate authority, created once and trusted once per phone.
type CA struct {
	cert *x509.Certificate
	der  []byte
	key  *ecdsa.PrivateKey
}

// LoadOrCreateCA reads the CA from dir, creating dir (0700), the key (0600) and the certificate
// when either file is missing.
func LoadOrCreateCA(dir string) (*CA, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("mobileweb: create CA dir: %w", err)
	}
	ca, err := loadCA(dir)
	if err == nil {
		return ca, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return createCA(dir)
}

// ResetCA deletes the CA and creates a fresh one. Every phone must trust the new root again.
func ResetCA(dir string) (*CA, error) {
	for _, name := range []string{caKeyFile, caCertFile} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("mobileweb: remove %s: %w", name, err)
		}
	}
	return LoadOrCreateCA(dir)
}

func loadCA(dir string) (*CA, error) {
	keyPEM, err := os.ReadFile(filepath.Join(dir, caKeyFile))
	if err != nil {
		return nil, err
	}
	certPEM, err := os.ReadFile(filepath.Join(dir, caCertFile))
	if err != nil {
		return nil, err
	}
	keyBlock, _ := pem.Decode(keyPEM)
	certBlock, _ := pem.Decode(certPEM)
	if keyBlock == nil || certBlock == nil {
		return nil, errors.New("mobileweb: CA files are not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: parse CA key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("mobileweb: CA key is not ECDSA")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: parse CA certificate: %w", err)
	}
	return &CA{cert: cert, der: certBlock.Bytes, key: key}, nil
}

func createCA(dir string) (*CA, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: generate CA key: %w", err)
	}
	serial, err := newSerial()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Kira Space local CA", Organization: []string{"Kira Space"}},
		NotBefore:             now.Add(-clockSkew),
		NotAfter:              now.Add(caValidity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
		PermittedIPRanges:     permittedIPRanges,
		PermittedDNSDomains:   []string{".local"},
		// Constraints only protect the phone if the verifier cannot ignore them.
		PermittedDNSDomainsCritical: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: create CA certificate: %w", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: parse new CA certificate: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("mobileweb: marshal CA key: %w", err)
	}
	if err := writeAtomic(filepath.Join(dir, caKeyFile), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return nil, err
	}
	if err := writeAtomic(filepath.Join(dir, caCertFile), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return nil, err
	}
	return &CA{cert: cert, der: der, key: key}, nil
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return fmt.Errorf("mobileweb: write %s: %w", filepath.Base(path), err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("mobileweb: install %s: %w", filepath.Base(path), err)
	}
	return nil
}

func newSerial() (*big.Int, error) {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("mobileweb: certificate serial: %w", err)
	}
	return serial, nil
}

// DER is the public CA certificate as served to phones.
func (c *CA) DER() []byte { return c.der }

// Pool is a trust pool holding only this CA.
func (c *CA) Pool() *x509.CertPool {
	pool := x509.NewCertPool()
	pool.AddCert(c.cert)
	return pool
}

// Fingerprint is the SHA-256 of the CA certificate as colon-separated upper-case hex, the form
// phones display, so the user can compare it with the desktop pane.
func (c *CA) Fingerprint() string {
	sum := sha256.Sum256(c.der)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

// IssueLeaf signs a TLS server certificate for the given addresses and returns it with its expiry.
// Valid 397 days, ECDSA P-256, serverAuth only: the limits iOS and Chrome enforce for a
// user-trusted root.
func (c *CA) IssueLeaf(ips []net.IP, dnsNames []string, now time.Time) (*tls.Certificate, time.Time, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("mobileweb: generate leaf key: %w", err)
	}
	serial, err := newSerial()
	if err != nil {
		return nil, time.Time{}, err
	}
	notAfter := now.Add(leafValidity)
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "Kira Space"},
		NotBefore:    now.Add(-clockSkew),
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  ips,
		DNSNames:     dnsNames,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, c.cert, &key.PublicKey, c.key)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("mobileweb: sign leaf: %w", err)
	}
	return &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, notAfter, nil
}

// CertHolder swaps the served leaf without restarting listeners.
type CertHolder struct {
	p atomic.Pointer[tls.Certificate]
}

func (h *CertHolder) Set(c *tls.Certificate) { h.p.Store(c) }

// GetCertificate is tls.Config.GetCertificate.
func (h *CertHolder) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	c := h.p.Load()
	if c == nil {
		return nil, errors.New("mobileweb: no certificate loaded")
	}
	return c, nil
}
